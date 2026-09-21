/*
 * AXIVERSE — Global Wallet Controller
 *
 * One file shared by index.html, profile.html, axi.html and stake.html.
 *
 * Desktop / in-app browser:
 *   - EIP-6963 discovery for injected EVM wallets.
 *   - Works with wallets such as Bitget, OKX, Rabby, MetaMask, Coinbase Wallet,
 *     and other wallets that expose an EIP-1193 provider.
 *
 * Mobile / QR:
 *   - Reown AppKit integration is prepared below.
 *   - Put the Reown Project ID in CONFIG.REOWN_PROJECT_ID to enable it.
 *
 * No private keys, seed phrases, or custody are handled by this script.
 */
(function () {
  'use strict';

  const CONFIG = {
    APP_NAME: 'Axiverse',
    APP_DESCRIPTION: 'Build your Axiverse.',
    APP_URL: window.location.origin,

    // Add your Reown Dashboard Project ID here when ready.
    REOWN_PROJECT_ID: 'd8f269a388cef485d24250c6d19a496a',

    // Robinhood Chain mainnet.
    CHAIN_ID: 4663,
    CHAIN_HEX: '0x1237',
    CHAIN_NAME: 'Robinhood Chain',
    RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
    EXPLORER_URL: 'https://robinhoodchain.blockscout.com',
    NATIVE_SYMBOL: 'ETH',

    // Canonical USDG on Robinhood Chain. 6 decimals.
    USDG_ADDRESS: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    USDG_DECIMALS: 6,
    USDG_SYMBOL: 'USDG',

    // Keep this true so the dApp asks wallets to move to Robinhood Chain.
    REQUIRE_ROBINHOOD_CHAIN: true,

    STORAGE_KEY: 'axiverse.wallet.v1'
  };

  const state = {
    address: null,
    chainId: null,
    provider: null,
    walletInfo: null,
    source: null, // 'eip6963' | 'reown'
    reownModal: null,
    reownReady: false,
    listeners: new Set(),
    menuOpen: false,
    restoring: false,
    balances: { eth: null, usdg: null }
  };

  const discovered = new Map();

  const EVENTS = {
    PROVIDER: 'eip6963:announceProvider',
    REQUEST: 'eip6963:requestProvider'
  };

  function emit(name, detail) {
    state.listeners.forEach(function (fn) {
      try { fn({ type: name, detail: detail }); } catch (e) {}
    });
    try {
      window.dispatchEvent(new CustomEvent('axiverse:wallet', { detail: { type: name, data: detail } }));
    } catch (e) {}
    if (typeof window.onWalletChange === 'function') {
      try { window.onWalletChange(detail); } catch (e) {}
    }
  }

  function on(fn) {
    if (typeof fn === 'function') state.listeners.add(fn);
    return function () { state.listeners.delete(fn); };
  }

  function shortAddress(address) {
    if (!address || address.length < 12) return address || '';
    return address.slice(0, 6) + '...' + address.slice(-4);
  }

  function hexChainId(value) {
    if (typeof value === 'number') return '0x' + value.toString(16);
    if (typeof value === 'string' && value.startsWith('0x')) return value.toLowerCase();
    if (typeof value === 'string' && /^\d+$/.test(value)) return '0x' + Number(value).toString(16);
    return null;
  }

  function chainNumber(value) {
    const hex = hexChainId(value);
    return hex ? parseInt(hex, 16) : null;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function walletName(info) {
    if (!info) return 'Wallet';
    return info.name || info.rdns || 'Wallet';
  }

  function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address || '');
  }

  function providerRequest(provider, method, params) {
    if (!provider || typeof provider.request !== 'function') {
      return Promise.reject(new Error('Wallet provider is unavailable.'));
    }
    return provider.request({ method: method, params: params });
  }

  async function rpc(method, params) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
    try {
      const response = await fetch(CONFIG.RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method, params: params || [] }),
        signal: controller ? controller.signal : undefined
      });
      const json = await response.json();
      if (json.error) throw new Error(json.error.message || 'RPC request failed.');
      return json.result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Read from the public RPC first; if that fails (CORS, timeout, outage) fall back
  // to the connected wallet's own provider, but only when it is on the right chain.
  async function chainRead(method, params) {
    try {
      return await rpc(method, params);
    } catch (rpcError) {
      if (state.provider && state.chainId === CONFIG.CHAIN_ID) {
        return await providerRequest(state.provider, method, params);
      }
      throw rpcError;
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function hexToBigInt(hex) {
    // '0x' (empty return data) is a valid RPC reply but BigInt('0x') throws.
    if (typeof hex !== 'string' || hex === '0x' || hex === '') return 0n;
    try { return BigInt(hex); } catch (e) { return 0n; }
  }

  function formatUnits(value, decimals, maxFraction) {
    if (value === null || value === undefined) return '—';
    const raw = typeof value === 'bigint' ? value : BigInt(value);
    const negative = raw < 0n;
    const n = negative ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const fractionRaw = n % base;
    if (fractionRaw === 0n) return (negative ? '-' : '') + whole.toString();

    let fraction = fractionRaw.toString().padStart(decimals, '0');
    fraction = fraction.replace(/0+$/, '');
    if (maxFraction && fraction.length > maxFraction) fraction = fraction.slice(0, maxFraction);
    fraction = fraction.replace(/0+$/, '');
    return (negative ? '-' : '') + whole.toString() + '.' + (fraction || '0');
  }

  function formatBalance(value, symbol) {
    if (value === null || value === undefined) return '— ' + symbol;
    return formatUnits(value, symbol === 'USDG' ? CONFIG.USDG_DECIMALS : 18, symbol === 'USDG' ? 2 : 6) + ' ' + symbol;
  }

  function saveState() {
    try {
      if (!state.address) {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
        return;
      }
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
        address: state.address,
        chainId: state.chainId,
        walletInfo: state.walletInfo,
        source: state.source
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || 'null');
      return saved && isValidAddress(saved.address) ? saved : null;
    } catch (e) {
      return null;
    }
  }

  function discoverProvider(detail) {
    if (!detail || !detail.provider) return;
    const info = detail.info || {};
    const key = info.rdns || info.uuid || info.name || ('provider-' + discovered.size);
    discovered.set(key, { info: info, provider: detail.provider });
    renderWalletModal();
  }

  window.addEventListener(EVENTS.PROVIDER, function (event) {
    discoverProvider(event.detail);
  });

  function requestProviders() {
    try {
      window.dispatchEvent(new Event(EVENTS.REQUEST));
    } catch (e) {}
  }

  function getInjectedFallbacks() {
    const out = [];
    const eth = window.ethereum;
    if (eth && !Array.from(discovered.values()).some(function (x) { return x.provider === eth; })) {
      out.push({
        info: { name: 'Browser Wallet', rdns: 'browser.injected', icon: '' },
        provider: eth
      });
    }
    if (window.okxwallet && !Array.from(discovered.values()).some(function (x) { return x.provider === window.okxwallet; })) {
      out.push({
        info: { name: 'OKX Wallet', rdns: 'com.okex.wallet', icon: '' },
        provider: window.okxwallet
      });
    }
    if (window.bitkeep && window.bitkeep.ethereum && !Array.from(discovered.values()).some(function (x) { return x.provider === window.bitkeep.ethereum; })) {
      out.push({
        info: { name: 'Bitget Wallet', rdns: 'com.bitget.web3', icon: '' },
        provider: window.bitkeep.ethereum
      });
    }
    return out;
  }

  function getWalletChoices() {
    const choices = Array.from(discovered.values());
    getInjectedFallbacks().forEach(function (item) {
      if (!choices.some(function (x) { return x.provider === item.provider; })) choices.push(item);
    });
    return choices;
  }

  function ensureWalletModalStyles() {
    if (document.getElementById('axiverse-wallet-style')) return;
    const style = document.createElement('style');
    style.id = 'axiverse-wallet-style';
    style.textContent = `
      .axw-backdrop{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:18px}
      .axw-modal{width:min(430px,100%);background:#f7f9ef;border:1px solid rgba(7,18,14,.16);border-radius:22px;box-shadow:0 28px 90px rgba(0,0,0,.28);padding:20px;color:#07120e;font-family:inherit}
      .axw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
      .axw-title{font-weight:900;letter-spacing:.12em;font-size:13px}
      .axw-close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#07120e;padding:4px}
      .axw-sub{font-size:12px;color:rgba(7,18,14,.58);margin:-7px 0 15px}
      .axw-list{display:grid;gap:9px}
      .axw-wallet{width:100%;border:1px solid rgba(7,18,14,.13);background:#fff;border-radius:14px;padding:13px 14px;display:flex;align-items:center;gap:12px;text-align:left;cursor:pointer;font:inherit;color:#07120e}
      .axw-wallet:hover{border-color:#7ca400;background:#fbfff0}
      .axw-icon{width:36px;height:36px;border-radius:10px;background:#edf4d5;display:grid;place-items:center;overflow:hidden;flex:0 0 36px;font-weight:900}
      .axw-icon img{width:100%;height:100%;object-fit:cover}
      .axw-wallet strong{font-size:13px}
      .axw-wallet span{display:block;font-size:10px;color:rgba(7,18,14,.5);margin-top:2px}
      .axw-reown{border-color:#07120e;background:#07120e;color:#fff;justify-content:center;text-align:center;font-weight:800;letter-spacing:.08em}
      .axw-reown:hover{background:#14251e;color:#fff}
      .axw-note{font-size:10px;color:rgba(7,18,14,.48);line-height:1.5;margin-top:13px;text-align:center}
      .axw-menu{position:fixed;z-index:99998;min-width:190px;background:#f7f9ef;border:1px solid rgba(7,18,14,.14);border-radius:15px;box-shadow:0 18px 50px rgba(0,0,0,.22);padding:7px;color:#07120e}
      .axw-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:11px 12px;border-radius:10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;color:#07120e}
      .axw-menu button:hover{background:#e9f2cc}
      .axw-menu .axw-danger{color:#8a2525}
      .axw-status{font-size:11px;color:#7d2525;text-align:center;margin-top:12px;display:none}
      #profileGate.hidden,#profileContent.hidden{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function closeConnectModal() {
    const el = document.getElementById('axiverse-wallet-modal');
    if (el) el.remove();
  }

  function openConnectModal() {
    ensureWalletModalStyles();
    closeConnectModal();
    createConnectModal();
    requestProviders();
    renderWalletModal();
    setTimeout(renderWalletModal, 80);
  }

  function renderWalletModal() {
    const old = document.getElementById('axiverse-wallet-modal');
    if (!old) return;

    const list = old.querySelector('.axw-list');
    if (!list) return;
    list.innerHTML = '';

    getWalletChoices().forEach(function (choice) {
      const btn = document.createElement('button');
      btn.className = 'axw-wallet';
      const info = choice.info || {};
      const icon = info.icon ? '<img src="' + escapeHtml(info.icon) + '" alt="">' : '<b>W</b>';
      btn.innerHTML = '<div class="axw-icon">' + icon + '</div><div><strong>' + escapeHtml(walletName(info)) + '</strong><span>Browser wallet</span></div>';
      btn.addEventListener('click', function () {
        closeConnectModal();
        connectInjected(choice.provider, choice.info).catch(handleError);
      });
      list.appendChild(btn);
    });

    if (CONFIG.REOWN_PROJECT_ID) {
      const btn = document.createElement('button');
      btn.className = 'axw-wallet axw-reown';
      btn.textContent = 'CONNECT MOBILE / MORE WALLETS';
      btn.addEventListener('click', function () {
        closeConnectModal();
        connectWithReown().catch(handleError);
      });
      list.appendChild(btn);
    } else if (isMobile()) {
      const note = old.querySelector('.axw-note');
      if (note) note.textContent = 'Mobile wallet connection will be enabled after the Reown Project ID is added.';
    }

    if (!getWalletChoices().length && !CONFIG.REOWN_PROJECT_ID) {
      const empty = document.createElement('div');
      empty.className = 'axw-note';
      empty.textContent = 'No injected wallet detected. Add a Reown Project ID for mobile and QR wallet connections.';
      list.appendChild(empty);
    }
  }

  function createConnectModal() {
    ensureWalletModalStyles();
    const backdrop = document.createElement('div');
    backdrop.id = 'axiverse-wallet-modal';
    backdrop.className = 'axw-backdrop';
    backdrop.innerHTML = `
      <div class="axw-modal" role="dialog" aria-modal="true" aria-label="Connect wallet">
        <div class="axw-head"><div class="axw-title">CONNECT WALLET</div><button class="axw-close" type="button" aria-label="Close">×</button></div>
        <div class="axw-sub">Choose a wallet to connect to Axiverse.</div>
        <div class="axw-list"></div>
        <div class="axw-note">Wallets are connected directly. Axiverse never receives your private key or recovery phrase.</div>
      </div>`;
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeConnectModal();
    });
    backdrop.querySelector('.axw-close').addEventListener('click', closeConnectModal);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  async function connectInjected(provider, info) {
    if (!provider) throw new Error('Wallet provider not found.');
    state.provider = provider;
    state.walletInfo = info || null;
    state.source = 'eip6963';

    const accounts = await providerRequest(provider, 'eth_requestAccounts');
    if (!accounts || !accounts[0]) throw new Error('No wallet account was returned.');
    state.address = accounts[0];

    await bindProviderEvents(provider);
    // If the user declines the network switch they stay connected, just flagged as
    // "Wrong Network" (pages such as Stake then offer a Switch button).
    try {
      await ensureTargetChain(provider);
    } catch (chainError) {
      console.warn('[Axiverse Wallet]', chainError);
      try { state.chainId = chainNumber(await providerRequest(provider, 'eth_chainId')); } catch (e) {}
    }
    saveState();
    updateWalletUI();
    updateProfileUI();
    emit('connected', getState());
    refresh().catch(function () {});
    return getState();
  }

  async function ensureTargetChain(provider) {
    const current = chainNumber(await providerRequest(provider, 'eth_chainId'));
    state.chainId = current;
    if (!CONFIG.REQUIRE_ROBINHOOD_CHAIN || current === CONFIG.CHAIN_ID) return;

    try {
      await providerRequest(provider, 'wallet_switchEthereumChain', [{ chainId: CONFIG.CHAIN_HEX }]);
    } catch (switchError) {
      const code = switchError && (switchError.code === 4902 || switchError.code === -32603);
      if (!code && switchError && switchError.code !== 4902) throw new Error('Please switch your wallet to Robinhood Chain.');
      await providerRequest(provider, 'wallet_addEthereumChain', [{
        chainId: CONFIG.CHAIN_HEX,
        chainName: CONFIG.CHAIN_NAME,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [CONFIG.RPC_URL],
        blockExplorerUrls: [CONFIG.EXPLORER_URL]
      }]);
    }

    state.chainId = chainNumber(await providerRequest(provider, 'eth_chainId'));
    if (state.chainId !== CONFIG.CHAIN_ID) throw new Error('Wallet is not connected to Robinhood Chain.');
  }

  async function bindProviderEvents(provider) {
    if (!provider || typeof provider.on !== 'function') return;
    if (provider.__axiverseWalletBound) return;
    provider.__axiverseWalletBound = true;

    provider.on('accountsChanged', async function (accounts) {
      if (state.provider !== provider) return;
      if (!accounts || !accounts.length) {
        clearState(true);
        emit('disconnected', getState());
        updateWalletUI();
        return;
      }
      state.address = accounts[0];
      saveState();
      emit('accountChanged', getState());
      await refresh().catch(function () {});
      updateWalletUI();
    });

    provider.on('chainChanged', async function (chainId) {
      if (state.provider !== provider) return;
      state.chainId = chainNumber(chainId);
      saveState();
      emit('chainChanged', getState());
      updateWalletUI();
      await refresh().catch(function () {});
    });

    provider.on('disconnect', function () {
      if (state.provider !== provider) return;
      clearState(true);
      emit('disconnected', getState());
      updateWalletUI();
    });
  }

  async function refresh() {
    const address = state.address;
    if (!address) return;

    // ETH and USDG are read independently so one failing read never blanks the other.
    const selector = '0x70a08231' + address.slice(2).padStart(64, '0');
    const results = await Promise.all([
      chainRead('eth_getBalance', [address, 'latest']).then(hexToBigInt).catch(function (e) {
        console.warn('[Axiverse Wallet] ETH balance read failed', e); return null;
      }),
      chainRead('eth_call', [{ to: CONFIG.USDG_ADDRESS, data: selector }, 'latest']).then(hexToBigInt).catch(function (e) {
        console.warn('[Axiverse Wallet] USDG balance read failed', e); return null;
      })
    ]);

    // The account may have changed / disconnected while the reads were in flight.
    if (state.address !== address) return;
    if (results[0] !== null) state.balances.eth = results[0];
    if (results[1] !== null) state.balances.usdg = results[1];
    updateProfileUI();
    updateWalletUI();
  }

  function clearState(removeStorage) {
    state.address = null;
    state.chainId = null;
    state.provider = null;
    state.walletInfo = null;
    state.source = null;
    state.balances = { eth: null, usdg: null };
    closeWalletMenu();
    if (removeStorage !== false) {
      try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch (e) {}
    }
  }

  async function disconnect() {
    // Injected wallets generally do not expose a safe programmatic disconnect.
    // Clearing the dApp session is the correct fallback.
    if (state.reownModal && state.source === 'reown') {
      try {
        if (typeof state.reownModal.disconnect === 'function') await state.reownModal.disconnect();
      } catch (e) {}
      state.reownReady = false;
      state.reownModal = null;
    }
    clearState(true);
    closeWalletMenu();
    updateWalletUI();
    updateProfileUI();
    emit('disconnected', getState());
  }

  async function loadReown() {
    if (!CONFIG.REOWN_PROJECT_ID) throw new Error('Reown Project ID is not configured yet.');
    if (state.reownReady && state.reownModal) return state.reownModal;

    // NOTE: full @reown/appkit is too heavy for a browser-ESM CDN load — its many
    // sub-packages (viem/ox/valtio) resolve to mismatched versions on esm.sh and
    // throw errors like "does not provide an export named 'TokenId'".
    // @walletconnect/ethereum-provider is the lean, official EIP-1193 provider
    // AppKit itself is built on top of, and it ships its own QR modal
    // (showQrModal: true), so it works reliably with a single CDN import.
    const mod = await import('https://esm.sh/@walletconnect/ethereum-provider@2.17.3?target=es2022');
    const EthereumProvider = mod.EthereumProvider;

    state.reownModal = await EthereumProvider.init({
      projectId: CONFIG.REOWN_PROJECT_ID,
      metadata: {
        name: CONFIG.APP_NAME,
        description: CONFIG.APP_DESCRIPTION,
        url: CONFIG.APP_URL,
        icons: []
      },
      showQrModal: true,
      optionalChains: [CONFIG.CHAIN_ID],
      rpcMap: (function () { const map = {}; map[CONFIG.CHAIN_ID] = CONFIG.RPC_URL; return map; })()
    });

    state.reownReady = true;
    return state.reownModal;
  }

  async function connectWithReown() {
    const provider = await loadReown();
    await provider.connect();

    const accounts = (provider.accounts && provider.accounts.length)
      ? provider.accounts
      : await providerRequest(provider, 'eth_requestAccounts');
    if (!accounts || !accounts[0]) throw new Error('Wallet connection was not completed.');

    state.provider = provider;
    state.walletInfo = { name: 'WalletConnect', rdns: 'walletconnect' };
    state.source = 'reown';
    state.address = accounts[0];
    await bindProviderEvents(provider);
    await ensureTargetChain(provider).catch(function () {
      if (provider.chainId) state.chainId = chainNumber(provider.chainId);
    });
    saveState();
    updateWalletUI();
    updateProfileUI();
    emit('connected', getState());
    refresh().catch(function () {});
    return getState();
  }

  async function switchChain() {
    if (!state.provider) throw new Error('Connect a wallet first.');
    await ensureTargetChain(state.provider);
    saveState();
    updateWalletUI();
    emit('chainChanged', getState());
    refresh().catch(function () {});
    return getState();
  }

  function getState() {
    return {
      connected: !!state.address,
      address: state.address,
      shortAddress: shortAddress(state.address),
      chainId: state.chainId,
      chainName: state.chainId === CONFIG.CHAIN_ID ? CONFIG.CHAIN_NAME : (state.chainId ? 'Wrong Network' : null),
      wallet: state.walletInfo ? walletName(state.walletInfo) : (state.source === 'reown' ? 'Reown' : null),
      source: state.source,
      balances: {
        eth: state.balances.eth,
        usdg: state.balances.usdg
      }
    };
  }

  function positionMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const width = 190;
    let left = rect.right - width;
    if (left < 10) left = 10;
    let top = rect.bottom + 8;
    if (top + 140 > window.innerHeight) top = Math.max(10, rect.top - 150);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function closeWalletMenu() {
    const menu = document.getElementById('axiverse-wallet-menu');
    if (menu) menu.remove();
    state.menuOpen = false;
  }

  function openWalletMenu(button) {
    ensureWalletModalStyles();
    closeWalletMenu();
    if (!state.address) return openConnectModal();

    const menu = document.createElement('div');
    menu.id = 'axiverse-wallet-menu';
    menu.className = 'axw-menu';
    menu.innerHTML = `
      <button type="button" data-action="profile">PROFILE</button>
      <button type="button" data-action="disconnect" class="axw-danger">DISCONNECT</button>`;
    document.body.appendChild(menu);
    positionMenu(button, menu);
    state.menuOpen = true;

    menu.querySelector('[data-action="profile"]').addEventListener('click', function () {
      closeWalletMenu();
      window.location.href = 'profile.html';
    });
    menu.querySelector('[data-action="disconnect"]').addEventListener('click', function () {
      disconnect().catch(handleError);
    });

    setTimeout(function () {
      document.addEventListener('click', outsideWalletMenu, { once: true });
    }, 0);
  }

  function outsideWalletMenu(e) {
    const menu = document.getElementById('axiverse-wallet-menu');
    if (!menu) return;
    if (!menu.contains(e.target)) closeWalletMenu();
  }

  function allWalletButtons() {
    return Array.from(document.querySelectorAll('.site-wallet, .mobile-wallet, #profileConnectBtn'));
  }

  function bindWalletButtons() {
    allWalletButtons().forEach(function (button) {
      if (button.__axiverseWalletBound) return;
      button.__axiverseWalletBound = true;
      button.addEventListener('click', function (event) {
        event.preventDefault();
        if (!state.address) return openConnectModal();
        if (document.getElementById('axiverse-wallet-menu')) closeWalletMenu();
        else openWalletMenu(button);
      });
    });
  }

  function updateWalletUI() {
    bindWalletButtons();
    if (!state.address) closeWalletMenu();
    document.querySelectorAll('.site-wallet, .mobile-wallet').forEach(function (button) {
      if (state.address) {
        button.textContent = shortAddress(state.address);
        button.classList.add('wallet-connected');
        button.setAttribute('aria-label', 'Wallet ' + state.address);
      } else {
        button.textContent = 'CONNECT WALLET';
        button.classList.remove('wallet-connected');
        button.removeAttribute('aria-label');
      }
    });

    const walletArea = document.getElementById('walletArea');
    if (walletArea) {
      walletArea.innerHTML = '';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'site-wallet ax-profile-wallet';
      button.textContent = state.address ? shortAddress(state.address) : 'CONNECT WALLET';
      walletArea.appendChild(button);
      button.addEventListener('click', function () {
        if (state.address) openWalletMenu(button); else openConnectModal();
      });
    }
  }

  function updateProfileUI() {
    const connected = !!state.address;
    const gate = document.getElementById('profileGate');
    const content = document.getElementById('profileContent');
    if (gate && content) {
      // While a saved session is still being restored show neither panel,
      // so the "Wallet not connected" gate does not flash on every page load.
      gate.classList.toggle('hidden', connected || state.restoring);
      content.classList.toggle('hidden', !connected);
    }

    const addressEl = document.getElementById('profileAddress');
    if (addressEl) addressEl.textContent = state.address ? shortAddress(state.address) : '—';

    const ethEl = document.getElementById('assetBalanceETH');
    if (ethEl) ethEl.textContent = formatBalance(state.balances.eth, 'ETH');
    const usdgEl = document.getElementById('assetBalanceUSDG');
    if (usdgEl) usdgEl.textContent = formatBalance(state.balances.usdg, 'USDG');

    const networkEl = document.getElementById('profileNetwork');
    if (networkEl) {
      networkEl.textContent = !connected ? '—'
        : (state.chainId === CONFIG.CHAIN_ID ? CONFIG.CHAIN_NAME.toUpperCase() : 'WRONG NETWORK');
    }

    document.querySelectorAll('.wallet-status').forEach(function (el) {
      if (connected) el.innerHTML = '<span class="dot"></span> WALLET CONNECTED';
      else el.textContent = 'WALLET NOT CONNECTED';
    });

    document.querySelectorAll('.wallet-meta .value').forEach(function (el) {
      el.textContent = connected && state.chainId === CONFIG.CHAIN_ID ? CONFIG.CHAIN_NAME.toUpperCase() : '—';
    });
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function handleError(error) {
    const message = error && error.message ? error.message : String(error || 'Wallet connection failed.');
    console.error('[Axiverse Wallet]', error);
    let status = document.querySelector('#axiverse-wallet-modal .axw-status');
    if (!status) {
      const modal = document.querySelector('#axiverse-wallet-modal .axw-modal');
      if (modal) {
        status = document.createElement('div');
        status.className = 'axw-status';
        modal.appendChild(status);
      }
    }
    if (status) {
      status.textContent = message;
      status.style.display = 'block';
    }
  }

  // Pick the provider that matches the saved session. `final` allows looser fallbacks
  // once we have waited long enough for late-injected mobile wallets.
  function findSavedProvider(saved, final) {
    const choices = getWalletChoices();
    const rdns = saved.walletInfo && saved.walletInfo.rdns;
    let match = rdns ? choices.find(function (c) { return c.info && c.info.rdns === rdns; }) : null;
    if (!match && (rdns === 'browser.injected' || final)) {
      match = choices.find(function (c) { return c.provider === window.ethereum; }) || (final ? choices[0] : null);
    }
    return match || null;
  }

  async function adoptRestored(provider, info, source, address) {
    state.provider = provider;
    state.walletInfo = info || null;
    state.source = source;
    state.address = address;
    await bindProviderEvents(provider);
    try {
      state.chainId = chainNumber(await providerRequest(provider, 'eth_chainId'));
    } catch (e) {
      if (provider.chainId) state.chainId = chainNumber(provider.chainId);
    }
    saveState();
    state.restoring = false;
    updateWalletUI();
    updateProfileUI();
    emit('restored', getState());
    refresh().catch(function () {});
  }

  async function restoreInjected(saved) {
    // Mobile in-app browsers inject the provider late and EIP-6963 can be missed,
    // so retry for a short while instead of a single 150ms attempt.
    const waits = [0, 150, 400, 800];
    let match = null;
    for (let i = 0; i < waits.length && !match; i++) {
      if (waits[i]) await sleep(waits[i]);
      requestProviders();
      match = findSavedProvider(saved, i === waits.length - 1);
    }
    if (!match) return;

    const accounts = await providerRequest(match.provider, 'eth_accounts');
    if (!accounts || !accounts.length) return; // wallet no longer authorises this site
    await adoptRestored(match.provider, match.info, 'eip6963', accounts[0]);
  }

  async function restoreReown() {
    // WalletConnect keeps its own session store; init() re-hydrates it.
    const provider = await loadReown();
    const accounts = provider.accounts || [];
    if (!provider.session || !accounts.length) return;
    await adoptRestored(provider, { name: 'WalletConnect', rdns: 'walletconnect' }, 'reown', accounts[0]);
  }

  async function restoreSession() {
    const saved = loadState();
    if (!saved) { state.restoring = false; return; }
    try {
      if (saved.source === 'reown') await restoreReown();
      else await restoreInjected(saved);
    } catch (e) {
      console.warn('[Axiverse Wallet] session restore failed', e);
    } finally {
      state.restoring = false;
      updateWalletUI();
      updateProfileUI();
    }
  }

  function installGlobalApi() {
    const api = {
      config: CONFIG,
      connect: openConnectModal,
      connectInjected: connectInjected,
      connectWithReown: connectWithReown,
      disconnect: disconnect,
      switchChain: switchChain,
      refresh: refresh,
      on: on,
      getState: getState,
      getAddress: function () { return state.address; },
      isConnected: function () { return !!state.address; },
      getProvider: function () { return state.provider; },
      getBalances: function () { return state.balances; },
      formatBalance: formatBalance,
      shortAddress: shortAddress
    };

    // Backward compatibility with the supplied profile.html.
    window.AxiverseWallet = api;
    window.KeyvraWallet = api;
  }

  function init() {
    state.restoring = !!loadState();
    ensureWalletModalStyles();
    requestProviders();
    bindWalletButtons();
    updateWalletUI();
    updateProfileUI();
    restoreSession();
  }

  // Expose the API immediately (not on DOMContentLoaded) so inline page scripts
  // that run before the DOM is ready, like Stake's, can subscribe right away.
  installGlobalApi();
  state.restoring = !!loadState();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
