// ═══════════════════════════════════════════════════════════════════
//   TAPSTAR · WALLET UI BRIDGE  (Phase 2)
//   Listens to TapStarWallet events and updates the lobby DOM.
//   Renders deposit/withdraw modals and tx toasts.
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Wait until both DOM and wallet module are ready.
  function whenReady(fn) {
    const tick = () => {
      if (document.readyState !== 'loading' && window.TapStarWallet) fn();
      else setTimeout(tick, 50);
    };
    tick();
  }

  whenReady(() => {
    const W = window.TapStarWallet;

    // ─── ELEMENT BUILDERS ─────────────────────────────────────────
    function buildWalletCard() {
      const host = document.querySelector('.wallet-row');
      if (!host) return null;

      // Replace old .wallet-row with new card
      const card = document.createElement('div');
      card.className = 'ts-wallet-card disconnected';
      card.id = 'tsWalletCard';
      card.innerHTML = `
        <div class="ts-wallet-row">
          <div class="ts-wallet-label">// WALLET STATUS</div>
          <div class="ts-wallet-value gold" id="tsAddrDisplay">NOT CONNECTED</div>
        </div>
        <div class="ts-wallet-actions">
          <button class="ts-walbtn connect" id="tsConnectBtn">CONNECT WALLET</button>
        </div>
      `;
      host.replaceWith(card);
      return card;
    }

    function buildModals() {
      if (document.getElementById('tsModalDeposit')) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="ts-modal" id="tsModalDeposit">
          <div class="ts-modal-box">
            <div class="ts-modal-title">DEPOSIT TO HAND</div>
            <div class="ts-modal-sub">Move funds from your wallet into your in-game Hand.<br>You'll need this balance to enter matches.</div>
            <div class="ts-modal-balances">
              <div class="ts-mb-cell"><div class="ts-mb-label">WALLET</div><div class="ts-mb-val" id="tsDepWallet">—</div></div>
              <div class="ts-mb-cell"><div class="ts-mb-label">HAND</div><div class="ts-mb-val" id="tsDepHand">—</div></div>
            </div>
            <div class="ts-modal-presets" id="tsDepPresets">
              <button class="ts-preset" data-amt="0.001">0.001</button>
              <button class="ts-preset" data-amt="0.005">0.005</button>
              <button class="ts-preset" data-amt="0.01">0.01</button>
              <button class="ts-preset" data-amt="0.05">0.05</button>
              <button class="ts-preset" data-amt="0.1">0.1</button>
            </div>
            <input type="number" class="ts-modal-input" id="tsDepAmount" placeholder="0.000" step="0.0001" min="0">
            <div class="ts-modal-error" id="tsDepError"></div>
            <div class="ts-modal-actions">
              <button class="ts-walbtn" onclick="window.TapStarUI.closeModal('tsModalDeposit')">CANCEL</button>
              <button class="ts-walbtn gold" id="tsDepGo">CONFIRM DEPOSIT</button>
            </div>
          </div>
        </div>
        <div class="ts-modal" id="tsModalWithdraw">
          <div class="ts-modal-box">
            <div class="ts-modal-title">WITHDRAW FROM HAND</div>
            <div class="ts-modal-sub">Move funds from your in-game Hand back to your wallet.</div>
            <div class="ts-modal-balances">
              <div class="ts-mb-cell"><div class="ts-mb-label">WALLET</div><div class="ts-mb-val" id="tsWdrWallet">—</div></div>
              <div class="ts-mb-cell"><div class="ts-mb-label">HAND</div><div class="ts-mb-val" id="tsWdrHand">—</div></div>
            </div>
            <input type="number" class="ts-modal-input" id="tsWdrAmount" placeholder="0.000" step="0.0001" min="0">
            <div class="ts-modal-error" id="tsWdrError"></div>
            <div class="ts-modal-actions">
              <button class="ts-walbtn" onclick="window.TapStarUI.closeModal('tsModalWithdraw')">CANCEL</button>
              <button class="ts-walbtn danger" id="tsWdrAllGo">WITHDRAW ALL</button>
              <button class="ts-walbtn gold" id="tsWdrGo">WITHDRAW</button>
            </div>
          </div>
        </div>
        <div class="ts-tx-toast" id="tsTxToast"></div>
      `;
      document.body.appendChild(wrap);
    }

    function buildNetworkWarn() {
      // Replace the old .network-warn with our themed one
      const old = document.getElementById('networkWarn');
      if (old) {
        old.className = 'ts-net-warn';
        old.id = 'tsNetWarn';
        old.textContent = '⚠ WRONG NETWORK — SWITCH IN YOUR WALLET';
      }
    }

    // ─── DOM RENDERERS ────────────────────────────────────────────
    function fmt(eth, decimals = 4) {
      if (eth === 0 || !isFinite(eth)) return '0.0000';
      if (eth < 0.0001) return eth.toExponential(2);
      return eth.toFixed(decimals);
    }

    function renderWalletCard(s) {
      const card = document.getElementById('tsWalletCard');
      if (!card) return;

      if (!s.connected) {
        card.className = 'ts-wallet-card disconnected';
        card.innerHTML = `
          <div class="ts-wallet-row">
            <div class="ts-wallet-label">// WALLET STATUS</div>
            <div class="ts-wallet-value gold">NOT CONNECTED</div>
          </div>
          <div class="ts-wallet-actions">
            <button class="ts-walbtn connect" id="tsConnectBtn">CONNECT WALLET</button>
          </div>
        `;
        document.getElementById('tsConnectBtn').onclick = () => W.connect();
        return;
      }

      card.className = 'ts-wallet-card';
      card.innerHTML = `
        <div class="ts-wallet-row">
          <div class="ts-wallet-label">WALLET · ${s.addressShort}</div>
          <div class="ts-wallet-value gold">${fmt(s.walletEth)} ${s.currency}</div>
        </div>
        <div class="ts-wallet-row">
          <div class="ts-wallet-label">HAND</div>
          <div class="ts-wallet-value cyan">${fmt(s.handEth)} ${s.currency}</div>
        </div>
        <div class="ts-wallet-actions">
          <button class="ts-walbtn gold" id="tsBtnDeposit">+ DEPOSIT</button>
          <button class="ts-walbtn" id="tsBtnWithdraw">↓ WITHDRAW</button>
          <button class="ts-walbtn danger" id="tsBtnDisconnect" title="Disconnect">✕</button>
        </div>
      `;
      document.getElementById('tsBtnDeposit').onclick    = () => openDepositModal();
      document.getElementById('tsBtnWithdraw').onclick   = () => openWithdrawModal();
      document.getElementById('tsBtnDisconnect').onclick = () => W.disconnect();

      // Header pill
      const headerBtn = document.getElementById('lobbyWalletBtn');
      if (headerBtn) {
        headerBtn.classList.add('connected', 'ts-addr');
        headerBtn.textContent = '[ ' + s.addressShort + ' ]';
        headerBtn.onclick = () => openWithdrawModal(); // tap header to manage funds
      }
    }

    function renderNetworkWarn(s) {
      const w = document.getElementById('tsNetWarn');
      if (!w) return;
      if (s.connected && !s.isCorrectChain) w.classList.add('show');
      else w.classList.remove('show');
    }

    function renderStakeHint(s) {
      // Add or update the hint under the QUICK MATCH button
      const quickBtn = document.querySelector('.mode-btn.pvp');
      if (!quickBtn) return;

      let hint = document.getElementById('tsQuickHint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'tsQuickHint';
        hint.className = 'ts-stake-hint';
        quickBtn.insertAdjacentElement('afterend', hint);
      }

      // Read configured QUICK_MATCH_STAKE from window if game.js exposes it,
      // else fall back to our default of 0.001 ETH.
      const stake = (typeof window.QUICK_MATCH_STAKE !== 'undefined')
        ? window.QUICK_MATCH_STAKE : 0.001;

      if (!s.connected) {
        hint.textContent = `// CONNECT WALLET TO PLAY · ${stake} ${s.currency} ENTRY`;
        hint.className = 'ts-stake-hint';
      } else {
        const verdict = W.canAffordStake(stake);
        if (verdict.ok) {
          hint.textContent = `// READY · ${stake} ${s.currency} ENTRY · YOUR HAND: ${fmt(s.handEth)}`;
          hint.className = 'ts-stake-hint ok';
        } else {
          hint.textContent = '// ' + verdict.reason.toUpperCase();
          hint.className = 'ts-stake-hint warn';
        }
      }

      // Also update the button's subtitle to reflect real currency
      const sub = quickBtn.querySelector('.mode-btn-sub');
      if (sub) sub.textContent = `RANDOM OPPONENT · ${stake} ${s.currency} STAKE`;
    }

    // ─── MODAL HANDLERS ───────────────────────────────────────────
    function openModal(id) { document.getElementById(id)?.classList.add('show'); }
    function closeModal(id) {
      const m = document.getElementById(id);
      if (m) m.classList.remove('show');
      // clear inputs
      m?.querySelectorAll('input').forEach(i => i.value = '');
      m?.querySelectorAll('.ts-modal-error').forEach(e => e.textContent = '');
      m?.querySelectorAll('.ts-preset.active').forEach(p => p.classList.remove('active'));
    }

    function openDepositModal() {
      const s = W.getState();
      if (!s.connected) { W.connect(); return; }
      document.getElementById('tsDepWallet').textContent = fmt(s.walletEth) + ' ' + s.currency;
      document.getElementById('tsDepHand').textContent   = fmt(s.handEth)   + ' ' + s.currency;
      openModal('tsModalDeposit');
    }

    function openWithdrawModal() {
      const s = W.getState();
      if (!s.connected) { W.connect(); return; }
      document.getElementById('tsWdrWallet').textContent = fmt(s.walletEth) + ' ' + s.currency;
      document.getElementById('tsWdrHand').textContent   = fmt(s.handEth)   + ' ' + s.currency;
      openModal('tsModalWithdraw');
    }

    function wireModalActions() {
      // Preset chips
      document.querySelectorAll('#tsDepPresets .ts-preset').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('#tsDepPresets .ts-preset').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('tsDepAmount').value = btn.dataset.amt;
        };
      });

      document.getElementById('tsDepGo').onclick = async () => {
        const amt = parseFloat(document.getElementById('tsDepAmount').value);
        const errEl = document.getElementById('tsDepError');
        if (!amt || amt <= 0) { errEl.textContent = 'Enter a valid amount'; return; }
        const s = W.getState();
        if (amt > s.walletEth) { errEl.textContent = `Wallet only has ${fmt(s.walletEth)} ${s.currency}`; return; }
        errEl.textContent = '';
        document.getElementById('tsDepGo').disabled = true;
        try {
          await W.deposit(amt);
          closeModal('tsModalDeposit');
        } catch (e) {
          errEl.textContent = friendlyError(e);
        } finally {
          document.getElementById('tsDepGo').disabled = false;
        }
      };

      document.getElementById('tsWdrGo').onclick = async () => {
        const amt = parseFloat(document.getElementById('tsWdrAmount').value);
        const errEl = document.getElementById('tsWdrError');
        if (!amt || amt <= 0) { errEl.textContent = 'Enter a valid amount'; return; }
        const s = W.getState();
        if (amt > s.handEth) { errEl.textContent = `Hand only has ${fmt(s.handEth)} ${s.currency}`; return; }
        errEl.textContent = '';
        document.getElementById('tsWdrGo').disabled = true;
        try {
          await W.withdraw(amt);
          closeModal('tsModalWithdraw');
        } catch (e) {
          errEl.textContent = friendlyError(e);
        } finally {
          document.getElementById('tsWdrGo').disabled = false;
        }
      };

      document.getElementById('tsWdrAllGo').onclick = async () => {
        const errEl = document.getElementById('tsWdrError');
        const s = W.getState();
        if (s.handEth <= 0) { errEl.textContent = 'Hand is empty'; return; }
        errEl.textContent = '';
        document.getElementById('tsWdrAllGo').disabled = true;
        try {
          await W.withdrawAll();
          closeModal('tsModalWithdraw');
        } catch (e) {
          errEl.textContent = friendlyError(e);
        } finally {
          document.getElementById('tsWdrAllGo').disabled = false;
        }
      };

      // Click-outside-to-close
      ['tsModalDeposit', 'tsModalWithdraw'].forEach(id => {
        const m = document.getElementById(id);
        m?.addEventListener('click', e => { if (e.target === m) closeModal(id); });
      });
    }

    // ─── TX TOAST ─────────────────────────────────────────────────
    let toastTimer = null;
    function showToast(msg, kind = '', hash = null) {
      const t = document.getElementById('tsTxToast');
      if (!t) return;
      let html = msg;
      if (hash) {
        html += ` <a href="${W.explorerTx(hash)}" target="_blank" rel="noopener">view ↗</a>`;
      }
      t.innerHTML = html;
      t.className = 'ts-tx-toast show ' + kind;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 6000);
    }

    function friendlyError(err) {
      if (!err) return 'Unknown error';
      const msg = err.shortMessage || err.message || String(err);
      if (msg.includes('user rejected') || err.code === 4001 || err.code === 'ACTION_REJECTED') return 'Cancelled in wallet';
      if (msg.includes('insufficient funds')) return 'Not enough funds for gas';
      if (msg.includes('paused')) return 'Contract is paused — try again later';
      return msg.slice(0, 90);
    }

    // ─── EVENT WIRING ─────────────────────────────────────────────
    function attachLobbyConnectButtons() {
      // Replace global connect functions so existing onclick="connectWalletLobby()"
      // and onclick="connectWalletAuth()" calls trigger AppKit instead of MetaMask.
      window.connectWalletLobby = () => W.connect();
      window.connectWalletAuth  = () => W.connect();
    }

    // Subscribe to wallet state changes
    W.onChange((event, s) => {
      renderWalletCard(s);
      renderNetworkWarn(s);
      renderStakeHint(s);

      // Sync to legacy globals so existing game code keeps working
      window.walletAddress = s.address;
      window.walletBalance = s.handEth; // game logic uses Hand balance for stake checks

      // Notify auth screen if visible
      const authStatus = document.getElementById('authWalletStatus');
      if (authStatus && s.connected) {
        authStatus.textContent = '✓ WALLET LINKED: ' + s.addressShort;
        authStatus.classList.add('connected');
      }

      // Toasts for tx events
      if (event === 'txSent')      showToast(`⏳ ${s.currency.toUpperCase()} TX SENT…`, '', arguments[0]?.hash);
      if (event === 'txConfirmed') {
        const a = arguments[0];
        if (a?.type === 'deposit')      showToast(`✓ DEPOSIT CONFIRMED`, 'success');
        else if (a?.type === 'withdraw' || a?.type === 'withdrawAll') showToast(`✓ WITHDRAWAL CONFIRMED`, 'success');
      }
      if (event === 'matchWon')  showToast(`🏆 MATCH WON · +${fmt(arguments[0]?.payout)} ${s.currency}`, 'success');
      if (event === 'matchLost') showToast(`✗ MATCH LOST · -${fmt(arguments[0]?.stake)} ${s.currency}`, 'error');
      if (event === 'connected') showToast(`✓ WALLET CONNECTED · ${s.addressShort}`, 'success');
      if (event === 'disconnected') showToast(`WALLET DISCONNECTED`);
    });

    // Listen for the AppKit modal-spawned tx events that come BEFORE
    // the subscriber gets the typed `event`. We need the raw arg.
    const origEmit = W.onChange;

    // ─── BOOT ─────────────────────────────────────────────────────
    buildWalletCard();
    buildModals();
    buildNetworkWarn();
    wireModalActions();
    attachLobbyConnectButtons();
    renderWalletCard(W.getState());
    renderStakeHint(W.getState());

    // Expose tiny helper API so legacy game code can ask "can the user afford this stake?"
    window.TapStarUI = {
      openDepositModal,
      openWithdrawModal,
      closeModal,
      canAffordStake: W.canAffordStake,
      refresh: W.refreshBalances
    };
  });
})();
