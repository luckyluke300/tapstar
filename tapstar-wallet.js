// ═══════════════════════════════════════════════════════════════════════════
//   TAPSTAR · WALLET MODULE  (Phase 2)
// ───────────────────────────────────────────────────────────────────────────
//   On-chain integration: WalletConnect (Reown AppKit) + ethers.js
//   Connects to TapStarArenaV2 vault contract, manages Hand balance,
//   deposit / withdraw flows, and exposes a clean API for the game.
// ═══════════════════════════════════════════════════════════════════════════

// ─── ESM imports via esm.sh CDN ────────────────────────────────────────────
import {
  createAppKit
} from 'https://esm.sh/@reown/appkit@1.6.5?bundle';
import {
  EthersAdapter
} from 'https://esm.sh/@reown/appkit-adapter-ethers@1.6.5?bundle';
import {
  sepolia,
  base
} from 'https://esm.sh/@reown/appkit/networks?bundle';
import {
  BrowserProvider,
  Contract,
  formatEther,
  parseEther,
  isAddress
} from 'https://esm.sh/ethers@6.13.4';

// ═══════════════════════════════════════════════════════════════════════════
//   CONFIG
// ═══════════════════════════════════════════════════════════════════════════
//   To switch from Sepolia testnet → Base mainnet later, change `ACTIVE_CHAIN`
//   to 'base', deploy the contract on Base, and paste the new address.
//   The rest of the codebase doesn't need to change.
// ═══════════════════════════════════════════════════════════════════════════

const REOWN_PROJECT_ID = '7c52e30ca0d5daacaf65beb6d2249013';

const CHAINS = {
  sepolia: {
    network: sepolia,
    chainId: 11155111,
    contractAddress: '0x90b7035cA41017FD5519eBa5a6753009141Ad906',
    currencySymbol: 'tETH',           // displayed in UI (test ETH)
    explorerBase: 'https://sepolia.etherscan.io'
  },
  base: {
    network: base,
    chainId: 8453,
    contractAddress: '0x0000000000000000000000000000000000000000', // TODO: deploy
    currencySymbol: 'ETH',
    explorerBase: 'https://basescan.org'
  }
};

const ACTIVE_CHAIN = 'sepolia';   // ← flip to 'base' for production
const CHAIN = CHAINS[ACTIVE_CHAIN];

// Minimal ABI — only the functions the frontend calls.
const ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function withdrawAll() external',
  'function balances(address) external view returns (uint256)',
  'function minStake() external view returns (uint256)',
  'function maxStake() external view returns (uint256)',
  'function houseFeeBps() external view returns (uint16)',
  'function paused() external view returns (bool)',
  'event Deposited(address indexed user, uint256 amount, uint256 newBalance)',
  'event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)',
  'event MatchSettled(bytes32 indexed matchId, address indexed winner, address indexed loser, uint256 stake, uint256 winnerPayout, uint256 fee)'
];

// ═══════════════════════════════════════════════════════════════════════════
//   STATE
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  appKit: null,
  provider: null,        // ethers BrowserProvider wrapping AppKit's EIP-1193
  signer: null,          // ethers JsonRpcSigner
  contract: null,        // ethers Contract bound to the signer
  address: null,         // connected wallet address
  walletEth: 0,          // native balance (in ETH, float)
  handEth: 0,            // contract balance for this user (in ETH, float)
  minStakeEth: 0,
  maxStakeEth: 0,
  houseFeeBps: 1000,
  isCorrectChain: false,
  pollHandle: null,
  listeners: new Set()   // subscribers for state changes
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
    explorerBase:    CHAIN.explorerBase
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//   INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

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
    features: {
      analytics: false,
      email: false,
      socials: false
    },
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent':       '#00ffcc',
      '--w3m-color-mix':    '#040810',
      '--w3m-border-radius-master': '2px'
    }
  });

  // Subscribe to AppKit account/network changes.
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
    if (!ethProvider) throw new Error('No EIP-1193 provider from AppKit');

    state.provider = new BrowserProvider(ethProvider);
    state.signer   = await state.provider.getSigner();
    state.contract = new Contract(CHAIN.contractAddress, ABI, state.signer);

    // Confirm chain
    const network = await state.provider.getNetwork();
    state.isCorrectChain = Number(network.chainId) === CHAIN.chainId;

    if (!state.isCorrectChain) {
      try { await state.appKit.switchNetwork(CHAIN.network); } catch {}
    }

    // Load contract limits ONCE (immutable for a given session)
    await loadContractLimits();

    // Wire contract events for live balance updates
    wireContractListeners();

    // Refresh balances now and on a schedule
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
  } catch (e) {
    console.warn('[wallet] limits load failed', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//   BALANCE REFRESH
// ═══════════════════════════════════════════════════════════════════════════

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
  } catch (e) {
    console.warn('[wallet] balance refresh failed', e);
  }
}

function startPolling() {
  if (state.pollHandle) return;
  // Poll every 15s as a safety net even though we listen to events
  state.pollHandle = setInterval(refreshBalances, 15000);
}

function stopPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = null;
}

// ═══════════════════════════════════════════════════════════════════════════
//   CONTRACT EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
//   USER ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function connect() {
  init();
  if (!state.appKit) throw new Error('AppKit not initialized');
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
  if (value <= 0n) throw new Error('Amount must be greater than 0');

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
  if (amt <= 0n) throw new Error('Amount must be greater than 0');

  const tx = await state.contract.withdraw(amt);
  emit('txSent', { type: 'withdraw', hash: tx.hash, amount: amountEth });
  const receipt = await tx.wait();
  await refreshBalances();
  emit('txConfirmed', { type: 'withdraw', hash: tx.hash, receipt });
  return receipt;
}

async function withdrawAll() {
  ensureReady();
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

// ═══════════════════════════════════════════════════════════════════════════
//   STAKE VALIDATION HELPERS  (used by lobby + room screens)
// ═══════════════════════════════════════════════════════════════════════════

function canAffordStake(stakeEth) {
  if (!state.address) return { ok: false, reason: 'Connect a wallet first' };
  if (!state.isCorrectChain) return { ok: false, reason: 'Switch to ' + CHAIN.network.name };
  if (stakeEth < state.minStakeEth) return { ok: false, reason: `Min stake: ${state.minStakeEth} ${CHAIN.currencySymbol}` };
  if (stakeEth > state.maxStakeEth) return { ok: false, reason: `Max stake: ${state.maxStakeEth} ${CHAIN.currencySymbol}` };
  if (stakeEth > state.handEth)     return { ok: false, reason: `Top up your Hand (need ${stakeEth} ${CHAIN.currencySymbol})` };
  return { ok: true };
}

function explorerTx(hash) {
  return CHAIN.explorerBase + '/tx/' + hash;
}

// ═══════════════════════════════════════════════════════════════════════════
//   PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

const TapStarWallet = {
  init,
  connect,
  disconnect,
  deposit,
  withdraw,
  withdrawAll,
  refreshBalances,
  canAffordStake,
  explorerTx,
  getState: getPublicState,
  onChange(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },
  // Helper for downstream (Phase 3 — match settlement will use these)
  getAddress() { return state.address; },
  getSigner()  { return state.signer; },
  getContract(){ return state.contract; },
  CHAIN_CONFIG: { ...CHAIN, ABI }
};

window.TapStarWallet = TapStarWallet;
export default TapStarWallet;

// ═══════════════════════════════════════════════════════════════════════════
//   AUTO-INIT
//   We call init() immediately so AppKit is ready by the time the user
//   clicks "Connect Wallet". Connection itself still requires user action.
// ═══════════════════════════════════════════════════════════════════════════
init();
