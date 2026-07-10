// ═══════════════════════════════════════════════════════════════════════════
//   TAPSTAR · WALLET MODULE  (Phase 2)
// ───────────────────────────────────────────────────────────────────────────
//   On-chain integration: WalletConnect (Reown AppKit) + ethers.js
//   Connects to TapStarArenaV4 vault contract, manages Hand balance,
//   deposit / withdraw flows, and exposes a clean API for the game.
// ═══════════════════════════════════════════════════════════════════════════

import { createAppKit } from 'https://esm.sh/@reown/appkit@1.6.5?bundle';
import { EthersAdapter } from 'https://esm.sh/@reown/appkit-adapter-ethers@1.6.5?bundle';
import { base } from 'https://esm.sh/@reown/appkit/networks?bundle';
import { BrowserProvider, Contract, formatEther, parseEther } from 'https://esm.sh/ethers@6.13.4';

const REOWN_PROJECT_ID = '7c52e30ca0d5daacaf65beb6d2249013';

const CHAIN = {
  network: base,
  chainId: 8453,
  contractAddress: '0xA0EC29013735f82fD9a494aCe375b86eBEb266D0',
  currencySymbol: 'ETH',
  explorerBase: 'https://basescan.org'
};

const ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function withdrawAll() external',
  'function balances(address) external view returns (uint256)',
  'function cooldownRemaining(address) external view returns (uint256)',
  'function minStake() external view returns (uint256)',
  'function maxStake() external view returns (uint256)',
  'function houseFeeBps() external view returns (uint16)',
  'function paused() external view returns (bool)',
  'function settleMatch(bytes32 matchId, address winner, address loser, uint256 stake, uint256 deadline, bytes signature) external',
  'function refundMatch(bytes32 matchId, address p1, address p2, uint256 stake, uint256 deadline, bytes signature) external',
  'function settledMatches(bytes32) external view returns (bool)',
  'event Deposited(address indexed user, uint256 amount, uint256 newBalance)',
  'event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)',
  'event MatchSettled(bytes32 indexed matchId, address indexed winner, address indexed loser, uint256 stake, uint256 winnerPayout, uint256 fee)',
  'event MatchRefunded(bytes32 indexed matchId, address indexed p1, address indexed p2, uint256 stake)'
];

const state = {
  appKit: null,
  provider: null,
  signer: null,
  contract: null,
  address: null,
  walletEth: 0,
  handEth: 0,
  minStakeEth: 0,
  maxStakeEth: 0,
  houseFeeBps: 1000,
  isCorrectChain: false,
  pollHandle: null,
  activeMatchId: null,
  listeners: new Set()
};

function emit(event) {
  state.listeners.forEach(fn => {
    try { fn(event, getPublicState()); } catch (e) { console.warn('[wallet listener]', e); }
  });
}

function getPublicState() {
  return {
    connected:       !!state.address,
    address:         state.address,
    addressShort:    state.address ? state.address.slice(0,6) + '…' + state.address.slice(-4) : null,
    walletEth:       state.walletEth,
    handEth:         state.handEth,
    minStakeEth:     state.minStakeEth,
    maxStakeEth:     state.maxStakeEth,
    houseFeeBps:     state.houseFeeBps,
    currency:        CHAIN.currencySymbol,
    isCorrectChain:  state.isCorrectChain,
    chainId:         CHAIN.chainId,
    contractAddress: CHAIN.contractAddress,
    explorerBase:    CHAIN.explorerBase,
    activeMatchId:   state.activeMatchId || null
  };
}

function init() {
  if (state.appKit) return;

  state.appKit = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [CHAIN.network],
    defaultNetwork: CHAIN.network,
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: 'TAPSTAR CHAIN',
      description: 'Real-stakes tap PvP on-chain',
      url: window.location.origin,
      icons: [window.location.origin + '/favicon.ico']
    },
    features: { analytics: false, email: false, socials: false },
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#00ffcc',
      '--w3m-color-mix': '#040810',
      '--w3m-border-radius-master': '2px'
    }
  });

  state.appKit.subscribeAccount(async (acc) => {
    if (acc.isConnected && acc.address) {
      state.address = acc.address;
      await onConnected();
    } else {
      onDisconnected();
    }
  });

  state.appKit.subscribeNetwork((net) => {
    state.isCorrectChain = net?.chainId === CHAIN.chainId;
    emit('chainChanged');
  });
}

async function onConnected() {
  try {
    const ethProvider = state.appKit.getProvider('eip155');
    if (!ethProvider) throw new Error('No EIP-1193 provider');

    state.provider = new BrowserProvider(ethProvider);
    state.signer   = await state.provider.getSigner();
    state.contract = new Contract(CHAIN.contractAddress, ABI, state.signer);

    const network = await state.provider.getNetwork();
    state.isCorrectChain = Number(network.chainId) === CHAIN.chainId;

    if (!state.isCorrectChain) {
      try { await state.appKit.switchNetwork(CHAIN.network); } catch {}
    }

    await loadContractLimits();
    wireContractListeners();
    await refreshBalances();
    startPolling();

    emit('connected');
  } catch (err) {
    console.error('[wallet] onConnected failed', err);
    emit('error', err);
  }
}

function onDisconnected() {
  stopPolling();
  unwireContractListeners();
  state.address = null;
  state.signer = null;
  state.contract = null;
  state.walletEth = 0;
  state.handEth = 0;
  emit('disconnected');
}

async function loadContractLimits() {
  if (!state.contract) return;
  try {
    const [minS, maxS, fee] = await Promise.all([
      state.contract.minStake(),
      state.contract.maxStake(),
      state.contract.houseFeeBps()
    ]);
    state.minStakeEth = parseFloat(formatEther(minS));
    state.maxStakeEth = parseFloat(formatEther(maxS));
    state.houseFeeBps = Number(fee);
  } catch (e) { console.warn('[wallet] limits load failed', e); }
}

async function refreshBalances() {
  if (!state.address || !state.provider || !state.contract) return;
  try {
    const [walletWei, handWei] = await Promise.all([
      state.provider.getBalance(state.address),
      state.contract.balances(state.address)
    ]);
    state.walletEth = parseFloat(formatEther(walletWei));
    state.handEth   = parseFloat(formatEther(handWei));
    emit('balancesUpdated');
  } catch (e) { console.warn('[wallet] balance refresh failed', e); }
}

function startPolling() {
  if (state.pollHandle) return;
  state.pollHandle = setInterval(refreshBalances, 15000);
}

function stopPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = null;
}

let activeFilters = [];

function wireContractListeners() {
  if (!state.contract || !state.address) return;
  unwireContractListeners();

  const me = state.address;
  const c  = state.contract;

  const fDep   = c.filters.Deposited(me);
  const fWdr   = c.filters.Withdrawn(me);
  const fWin   = c.filters.MatchSettled(null, me, null);
  const fLose  = c.filters.MatchSettled(null, null, me);

  const onAny = () => refreshBalances();

  c.on(fDep,  onAny);
  c.on(fWdr,  onAny);
  c.on(fWin,  (matchId, winner, loser, stake, payout, fee) => {
    refreshBalances();
    emit('matchWon', { matchId, payout: parseFloat(formatEther(payout)) });
  });
  c.on(fLose, (matchId, winner, loser, stake) => {
    refreshBalances();
    emit('matchLost', { matchId, stake: parseFloat(formatEther(stake)) });
  });

  activeFilters = [fDep, fWdr, fWin, fLose];
}

function unwireContractListeners() {
  if (!state.contract) { activeFilters = []; return; }
  activeFilters.forEach(f => { try { state.contract.removeAllListeners(f); } catch {} });
  activeFilters = [];
}

async function connect() {
  init();
  await state.appKit.open();
}

async function disconnect() {
  if (!state.appKit) return;
  try { await state.appKit.disconnect(); } catch {}
  onDisconnected();
}

async function deposit(amountEth) {
  ensureReady();
  const value = parseEther(String(amountEth));
  const tx = await state.contract.deposit({ value });
  emit('txSent', { type: 'deposit', hash: tx.hash, amount: amountEth });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'deposit', hash: tx.hash, receipt });
  return receipt;
}

async function withdraw(amountEth) {
  ensureReady();
  const amt = parseEther(String(amountEth));
  if (state.activeMatchId) throw new Error('Cannot withdraw during an active match');
  const tx = await state.contract.withdraw(amt);
  emit('txSent', { type: 'withdraw', hash: tx.hash, amount: amountEth });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'withdraw', hash: tx.hash, receipt });
  return receipt;
}

async function withdrawAll() {
  ensureReady();
  if (state.activeMatchId) throw new Error('Cannot withdraw during an active match');
  const tx = await state.contract.withdrawAll();
  emit('txSent', { type: 'withdrawAll', hash: tx.hash });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'withdrawAll', hash: tx.hash, receipt });
  return receipt;
}

function ensureReady() {
  if (!state.address)        throw new Error('Wallet not connected');
  if (!state.contract)       throw new Error('Contract not initialized');
  if (!state.isCorrectChain) throw new Error('Wrong network — please switch chain');
}

function setActiveMatch(matchId) {
  state.activeMatchId = matchId || null;
  emit('activeMatchChanged');
}

function getActiveMatch() { return state.activeMatchId || null; }

async function settleMatch({ matchId, winner, loser, stake, deadline, signature }) {
  ensureReady();
  const already = await state.contract.settledMatches(matchId);
  if (already) {
    emit('matchAlreadySettled', { matchId });
    await refreshBalances();
    return null;
  }
  const tx = await state.contract.settleMatch(matchId, winner, loser, stake, deadline, signature);
  emit('txSent', { type: 'settle', hash: tx.hash, matchId });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'settle', hash: tx.hash, matchId, receipt });
  return receipt;
}

async function refundMatch({ matchId, p1, p2, stake, deadline, signature }) {
  ensureReady();
  const already = await state.contract.settledMatches(matchId);
  if (already) {
    emit('matchAlreadySettled', { matchId });
    await refreshBalances();
    return null;
  }
  const tx = await state.contract.refundMatch(matchId, p1, p2, stake, deadline, signature);
  emit('txSent', { type: 'refund', hash: tx.hash, matchId });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'refund', hash: tx.hash, matchId, receipt });
  return receipt;
}

async function isMatchSettled(matchId) {
  if (!state.contract) return false;
  try { return await state.contract.settledMatches(matchId); } catch { return false; }
}

function canAffordStake(stakeEth) {
  if (!state.address) return { ok: false, reason: 'Connect a wallet first' };
  if (!state.isCorrectChain) return { ok: false, reason: 'Switch to Base Mainnet' };
  if (stakeEth < state.minStakeEth) return { ok: false, reason: `Min stake: ${state.minStakeEth} ETH` };
  if (stakeEth > state.maxStakeEth) return { ok: false, reason: `Max stake: ${state.maxStakeEth} ETH` };
  if (stakeEth > state.handEth)     return { ok: false, reason: `Top up Hand (need ${stakeEth} ETH)` };
  return { ok: true };
}

async function getCooldownRemaining() {
  if (!state.contract || !state.address) return 0;
  try {
    const secs = await state.contract.cooldownRemaining(state.address);
    return Number(secs);
  } catch { return 0; }
}

function explorerTx(hash) { return CHAIN.explorerBase + '/tx/' + hash; }

const TapStarWallet = {
  init, connect, disconnect, deposit, withdraw, withdrawAll, refreshBalances,
  canAffordStake, getCooldownRemaining, explorerTx, settleMatch, refundMatch,
  isMatchSettled, setActiveMatch, getActiveMatch, getState: getPublicState,
  onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
  getAddress() { return state.address; },
  getSigner()  { return state.signer; },
  getContract(){ return state.contract; },
  CHAIN_CONFIG: { ...CHAIN, ABI }
};

window.TapStarWallet = TapStarWallet;
export default TapStarWallet;
init();