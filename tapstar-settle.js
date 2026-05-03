// ═══════════════════════════════════════════════════════════════════════════
//   TAPSTAR · SETTLEMENT ORCHESTRATOR  (Phase 3)
// ───────────────────────────────────────────────────────────────────────────
//   Bridges the game's endGame() flow with the on-chain contract.
//
//   Flow:
//     1. endGame() writes finalReport to RTDB and calls TapStarSettle.handleMatchEnd()
//     2. We poll the signer Worker until it returns a {settle|refund} signature
//     3. If we are the winner (or refund recipient), call the contract
//     4. Update result-screen UI as we transition through states
//
//   States: writing → waiting_other → signing → submitting → confirmed | refunded | error
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const WORKER_URL = 'https://tapstar-signer.gregmuco1.workers.dev';

  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS  = 6 * 60 * 1000;   // 6 min — slightly longer than worker's 5-min refund cutoff
  const REPORT_VERSION   = 1;

  // ─── INTERNAL STATE ───────────────────────────────────────────
  const state = {
    activeRoom: null,          // room code currently being settled
    pollHandle: null,
    pollDeadline: 0,
    onUpdate: null             // callback into UI: (status, data) => void
  };

  // ─── HELPERS ──────────────────────────────────────────────────
  function emit(status, data = {}) {
    if (state.onUpdate) {
      try { state.onUpdate(status, data); } catch (e) { console.warn('[settle ui]', e); }
    }
  }

  function fmt(n, d = 4) {
    return (typeof n === 'number' ? n : parseFloat(n) || 0).toFixed(d);
  }

  // Build the finalReport this client writes to RTDB.
  // Each player reports BOTH scores from their POV — the worker compares.
  function buildFinalReport({ myScore, oppScore }) {
    return {
      version:  REPORT_VERSION,
      myScore:  Math.max(0, Math.floor(myScore)),
      oppScore: Math.max(0, Math.floor(oppScore)),
      reportedAt: window.firebase?.database?.ServerValue?.TIMESTAMP || Date.now()
    };
  }

  // ─── MAIN ENTRY POINT ─────────────────────────────────────────
  /**
   * Called by index.html's endGame() when an online PvP match finishes.
   *
   * @param {Object} ctx
   *   roomCode        - RTDB room code
   *   myPlayerNum     - 1 or 2
   *   isHost          - true if this client is p1 (responsible for marking 'finished')
   *   myScore         - my final cell count
   *   oppScore        - opponent's final cell count
   *   stakeEth        - stake amount in ETH (float)
   *   onUpdate        - status callback (status, data)
   *
   * @returns {Promise<{outcome, txHash}|null>} resolves when settlement finishes
   */
  async function handleMatchEnd(ctx) {
    const W = window.TapStarWallet;
    if (!W) { console.error('[settle] wallet module missing'); return null; }
    if (!ctx.roomCode) { console.error('[settle] no roomCode'); return null; }

    state.activeRoom = ctx.roomCode;
    state.onUpdate   = ctx.onUpdate || null;

    const db = window.db || window.firebase?.database();
    if (!db) { emit('error', { reason: 'firebase unavailable' }); return null; }

    // ── 1. Write our finalReport to RTDB ────────────────────────
    emit('writing');
    const myKey = `rooms/${ctx.roomCode}/p${ctx.myPlayerNum}/finalReport`;
    const report = buildFinalReport({ myScore: ctx.myScore, oppScore: ctx.oppScore });
    try {
      await db.ref(myKey).set(report);
      // Host marks the match finished + stamps finishedAt
      if (ctx.isHost) {
        await db.ref(`rooms/${ctx.roomCode}`).update({
          status: 'finished',
          finishedAt: window.firebase.database.ServerValue.TIMESTAMP
        });
      }
    } catch (e) {
      emit('error', { reason: 'failed to write report: ' + (e.message || e) });
      return null;
    }

    // ── 2. Poll the worker until it returns a signature ─────────
    emit('waiting_other');
    const result = await pollWorker(ctx.roomCode);
    if (!result) {
      emit('error', { reason: 'signing timed out' });
      return null;
    }

    if (result.error) {
      emit('error', { reason: result.error });
      return null;
    }

    // ── 3. Submit to contract (only by the responsible client) ──
    const myAddr = (W.getAddress() || '').toLowerCase();

    if (result.kind === 'settle') {
      const isWinner = myAddr === result.winner.toLowerCase();
      if (isWinner) {
        return submitSettle(result, ctx);
      } else {
        emit('opponent_settling', { winner: result.winner });
        // Loser waits for the on-chain event listener to fire matchLost,
        // which the wallet UI module already handles. We're done here.
        return { outcome: 'loss', txHash: null };
      }
    }

    if (result.kind === 'refund') {
      // Either party can submit refund. Use a simple deterministic rule:
      // the alphabetically-lower address submits — avoids both clients
      // racing and wasting gas.
      const lower = [result.p1, result.p2].sort()[0].toLowerCase();
      if (myAddr === lower) {
        return submitRefund(result, ctx);
      } else {
        emit('opponent_refunding', { reason: result.reason });
        return { outcome: 'refund', txHash: null };
      }
    }

    emit('error', { reason: 'worker returned unknown kind: ' + result.kind });
    return null;
  }

  // ─── WORKER POLLING ───────────────────────────────────────────
  async function pollWorker(roomCode) {
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT_MS) {
      try {
        const r = await fetch(WORKER_URL + '/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode })
        });
        const data = await r.json();

        // Pending = both reports not yet in. Keep polling.
        if (data.status === 'pending') {
          emit('waiting_other', { reason: data.reason });
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        // Got a signature, or a hard error
        return data;
      } catch (e) {
        console.warn('[settle] poll error', e);
        await sleep(POLL_INTERVAL_MS);
      }
    }
    return null;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── SUBMIT SETTLEMENT TX ─────────────────────────────────────
  async function submitSettle(sig, ctx) {
    const W = window.TapStarWallet;
    emit('signing', { kind: 'settle' });

    try {
      // Idempotent: if it's already on-chain, treat as success
      const already = await W.isMatchSettled(sig.matchId);
      if (already) {
        emit('confirmed', { txHash: null, outcome: 'win', payoutEth: estimateWinnerPayout(sig.stake, ctx) });
        return { outcome: 'win', txHash: null };
      }

      emit('submitting', { kind: 'settle' });
      const receipt = await W.settleMatch({
        matchId:   sig.matchId,
        winner:    sig.winner,
        loser:     sig.loser,
        stake:     sig.stake,
        deadline:  sig.deadline,
        signature: sig.signature
      });
      emit('confirmed', {
        txHash: receipt?.hash || receipt?.transactionHash,
        outcome: 'win',
        payoutEth: estimateWinnerPayout(sig.stake, ctx)
      });
      return { outcome: 'win', txHash: receipt?.hash };
    } catch (e) {
      emit('error', { reason: friendlyTxError(e) });
      return null;
    }
  }

  // ─── SUBMIT REFUND TX ─────────────────────────────────────────
  async function submitRefund(sig, ctx) {
    const W = window.TapStarWallet;
    emit('signing', { kind: 'refund' });

    try {
      const already = await W.isMatchSettled(sig.matchId);
      if (already) {
        emit('refunded', { txHash: null, reason: sig.reason });
        return { outcome: 'refund', txHash: null };
      }

      emit('submitting', { kind: 'refund' });
      const receipt = await W.refundMatch({
        matchId:   sig.matchId,
        p1:        sig.p1,
        p2:        sig.p2,
        stake:     sig.stake,
        deadline:  sig.deadline,
        signature: sig.signature
      });
      emit('refunded', { txHash: receipt?.hash, reason: sig.reason });
      return { outcome: 'refund', txHash: receipt?.hash };
    } catch (e) {
      emit('error', { reason: friendlyTxError(e) });
      return null;
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────
  function estimateWinnerPayout(stakeWei, ctx) {
    // pot = stake * 2; winner gets pot * (1 - houseFee)
    // Use the wallet's known fee bps if available
    const stakeEth = parseFloat(stakeWei) / 1e18;
    const W = window.TapStarWallet?.getState();
    const feeBps = W?.houseFeeBps ?? 1000;
    const payout = stakeEth * 2 * (1 - feeBps / 10000);
    return payout;
  }

  function friendlyTxError(e) {
    if (!e) return 'unknown error';
    const msg = e.shortMessage || e.message || String(e);
    if (msg.includes('user rejected') || e.code === 'ACTION_REJECTED' || e.code === 4001)
      return 'cancelled in wallet';
    if (msg.includes('insufficient funds')) return 'not enough gas';
    if (msg.includes('expired')) return 'signature expired — refresh and try again';
    if (msg.includes('already settled')) return 'match already settled';
    if (msg.includes('bad signature')) return 'invalid signature — please report this bug';
    return msg.slice(0, 100);
  }

  // ─── EXPORT ───────────────────────────────────────────────────
  window.TapStarSettle = {
    handleMatchEnd
  };
})();
