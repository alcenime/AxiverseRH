/*
 * AXIVERSE — Global Wallet Controller
 *
 * One file shared by index.html, docs.html, profile.html, axi.html and mining.html.
 *
 * Desktop / in-app browser:
 *   - EIP-6963 discovery for injected EVM wallets.
 *   - Works with wallets such as Bitget, OKX, Rabby, MetaMask,
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

  // In-app browsers (OKX, Bitget) expose window.okxwallet / window.bitkeep instead of
  // EIP-6963, so they never send an icon. Reuse the logo from POPULAR_WALLETS.
  function popularIcon(rdns) {
    const wallet = POPULAR_WALLETS.find(function (w) { return w.rdns === rdns; });
    return wallet && wallet.icon ? wallet.icon : '';
  }

  function getInjectedFallbacks() {
    const out = [];
    const eth = window.ethereum;
    if (eth && !Array.from(discovered.values()).some(function (x) { return x.provider === eth; })) {
      out.push({
        info: { name: 'Browser Wallet', rdns: 'browser.injected', icon: 'data:image/webp;base64,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' },
        provider: eth
      });
    }
    if (window.okxwallet && !Array.from(discovered.values()).some(function (x) { return x.provider === window.okxwallet; })) {
      out.push({
        info: { name: 'OKX Wallet', rdns: 'com.okex.wallet', icon: popularIcon('com.okex.wallet') },
        provider: window.okxwallet
      });
    }
    if (window.bitkeep && window.bitkeep.ethereum && !Array.from(discovered.values()).some(function (x) { return x.provider === window.bitkeep.ethereum; })) {
      out.push({
        info: { name: 'Bitget Wallet', rdns: 'com.bitget.web3', icon: popularIcon('com.bitget.web3') },
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

  /* ==========================================================================
   * Connect-wallet modal (Pons-style)
   *
   * List view      : detected wallets (INSTALLED) -> popular wallets -> Search Wallet
   * Connecting view: "Continue in <wallet>" with spinner, error + Try again
   *
   * To use real logos for the popular wallets, fill the `icon` field below
   * with your own image path, e.g. icon: 'img/wallets/metamask.png'.
   * ======================================================================== */

  const MODAL_MAX_ROWS = 5;

  // Wallets shown when they are NOT detected in the browser.
  //  - deeplink : opens the site inside the wallet's in-app browser (mobile only)
  //  - install  : download page (used only when WalletConnect is not configured)
  const POPULAR_WALLETS = [
    {
      name: 'MetaMask', match: 'metamask', rdns: 'io.metamask', color: '#e2761b', letter: 'M', icon: 'data:image/webp;base64,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',
      deeplink: function (url) { return 'https://metamask.app.link/dapp/' + url.replace(/^https?:\/\//, ''); },
      install: 'https://metamask.io/download/'
    },
    {
      name: 'Trust Wallet', match: 'trust', rdns: 'com.trustwallet.app', color: '#0b5cff', letter: 'T', icon: 'data:image/webp;base64,UklGRh4FAABXRUJQVlA4WAoAAAAQAAAAdwAAdwAAQUxQSM0AAAABcFzbttJcvCMbWhfRTrBWfhlxGwEpgkUNcXe50yQiJgD3mmGnXBy+9qLshCaeqTXG68PXX49r2kNudiCZuQ/EB577+B5VHKgK9ZY4kBU30gPd9Ip/IBwA0AtGcwNoHSi3Ic04zSRnw2njJAfSSZ9Vv2JVLVktD3////3/A+qS1bJiVfVZ9RNWibPhtHGkGaeZhDanFmDMGRU6gICRj8uUT4rrgo3ATVVwEeotIN4TiXG/m7HIXDyq1cbr77ceNzQ80wy75eJ7LcpOaOJeAFZQOCAqBAAAMBkAnQEqeAB4AD5JIo5FIqIhFMm0iCgEhKRHcX3IMT9H/Kr2O7J/gPwbxyJs+sX8h+XP877ZHihf4D8se4H5h/1m/W73gP7B/M/an6AH9a/p/pK+wn6AH7O+ln+0fwe/uL+0vszarmvyRYT5UxD/t+XH6P/3e9AeiqWKmXiQav4f//u98/v4/K6QilyCPBK67qE/+VjnKMKp3sWn4qDTQfPIVU+/NVj3PteybGb2LshUWI1BQwoYL6Jjhqb/Vh+G5W99LoAqyoC+ZR/qZeJMBZZwAP79wIA5OIwNi9Hl/QM43aY0aNRnyKgTZ2KPksaXAuQP7FyjpUP2Qh95P5rwT+Ja7NKsAMuTSHN/BWckmrf/h672H5bvYZOvb53Fw30znSa/nTZ0EwZANIt2y+ozX8V8Vc20HkQW8By/h5X27WsRAvZvdCsFJNK+o6qSQwU4u3Tv2PmZPHtIM/nxKCVMSFbt5Q4wpkxqq4rvRytNogEmrvGaHSEPyybMs4jQ01DRsFrY/ymHwpbZ9rfZ/qzxQBDvEhzdAfS0h47bq2ODK0YzWz/pHUVSkekHkM+xq0BCLP4H//FUrzdLf/KQwCFC1kVPd+PNd9amA+sgvA+E5GCbnzhWkPMgsoOtCgDQsLxlOJBZ8UjzZ0RlN0IyKfQw43uCjbYEswmy2BbQmk3vgZMaoiHIzoyhNiTd3qG1EyEe2eFM29D2pMfPJeQp6/Ph0pn5I1HOzblkL4VufW1lT3vKmr2iqgfBilLztPjk7UzrJ79hmyAemJ3B0JL+brpfwDGVToLaedSPeyjjA3G/18tCiOqeJ4zK5meAc7yHjpY7b+YB55WYDxFJWFgzmc1UCiHeEsmXTdJ8FdzZrOiQXnPA1Fc+DcGHy8yNTWXdPkw3f0wcFUvNM/7oLX2zrDy4r5SaOuANhB2U2sGMcP4Y3vC0HC9X+tMBowgAV3Zd0UuSXaGy9GPAoQhC9LA96Hul2Vp3cRgZgaGpq/t8JvQ7aILU9e7yVgqfzMkwzWS/4n1aDL2naajCH9k7j5DojhIsd0owFGet3TTuJ6b2y+yPN4PkXs96hxx/GZvtUnuQW5UEp5C2RQex6fV/DIh2XVByKfXn31kZmaTVt59fP6GEAdBx6q5uUcHVivvWJ0OftTYnfgYU7OqHrtttYFH5Wmb/v3H4sYhsEZQuPE+GbmUwTlPQy4qxS8a0gD+4R99/6obUBvWp/9JOgW5QymKQc2sulSGE1Twp+BeIn/l1vf/f4vc8J8iSU2HZGy+hiG9ODXUQGaxjCqXmEiNZF62GgceYWBoxxSjh+W65vBkWGbWU2k35HC32UpXKKOtQMhL1fpUHHu4k9X0rALZ5oHFgEK5SwCYMeJaNXyR+ia6pO8fnNvTKP9Q8Iea+WzHuq7xfANNrVquf7wgAAAAAAA==',
      deeplink: function (url) { return 'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(url); },
      install: 'https://trustwallet.com/download'
    },
    {
      name: 'OKX Wallet', match: 'okx', rdns: 'com.okex.wallet', color: '#111111', letter: 'O', icon: 'data:image/webp;base64,UklGRr4BAABXRUJQVlA4ILIBAABwEACdASp4AHgAPkkgjEOioqGYPwRkKASEtIALalUA+wCyN/ongAbbvJAvlMdN/GfQX/o3Uz9AAjkZucVq+ScElyhxVES8RRjvKysrkejTORbej6xur3wS/a4xhtbRbCVCD+u982lhdE0Sq4tBm0+OtG/wHO4wCnYtutEHN5yk6KUTPL+gG6HtBEjEAAD+/TZohNPjrq0ebIIlm1Z0xctEnNoc/ea6p1RIM2TY1JzvX5Ca/oPH+af+apy7Ge8er22ODKY22+FbvyfjmnUXlfha0Dt5rsX7oYw72tXagN/vz6rJGq3SG1is//zvWYVVO9Kkzy8lBN8FV7Y2L80SmEqS5r7PcZ+G703hfNheky352R1zm9k1Wf1ckj+i2ppfeGhOQUrQX+q780h/5M/k2/+KVGpOr1OAEVH8rUAW7PdYTVtyNn8LsbkcfCXv5/uJA7XBu6XouFk+mCiXT6asrOj/+DqXNc9cj4XtCzikoWUkX7lzkInL6ZK9cosET4MA/ALJR+GNIfbF8Mr6EtMyIFVayQpuFHM/jcfjDmJAjnT4w4TsqFORVllkff+lXplMCAAAAA==',
      deeplink: function (url) { return 'okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(url); },
      install: 'https://www.okx.com/web3'
    },
    {
      name: 'Bitget Wallet', match: 'bitget', rdns: 'com.bitget.web3', color: '#0fb5c4', letter: 'B', icon: 'data:image/webp;base64,UklGRoQEAABXRUJQVlA4IHgEAADwGgCdASp4AHgAPkkijkSioiEViuwYKASEoA1mlBft34wa412P+RfsX/KP2j6aPhb4b+gP255E5DnVP+b+w/tAeYB+gH+X+wDuj/xn0Afyn+0b4B/Kv85/////2gHoAeWp+z3wR/tj/2P+j8BP60f9fWVbMfNPYDfj3grgJVFNE8S+oB0XinsYJGgo/FkeY5IoC+csPewtEWSwv5GIJ8uZePpqTfC/EGSyER8Ej8duXKxxxQYs1Pf0bcKHwDTQZ99/M4iw9E/l2i4rDJ7LucaWrcLfxrSIK93ECSgkaLmLIAD+/QnAIje57//wWn0sAKY1f3r6T+hs3/eaGQNUyQaLMmsfxdinMQAblL3CHslb1GTtWxAsnnOCQfXFrLcUmmCUUyy3onjBvR2d6sQQK+fH+19AgTks3siUyyKRmD8QB6jOlD0pyJ95cAh42TpmvnkrO4vJ4FotBEtdkmQesBWCLnIBzUwOlJ/l0AwtRPQiBqFIMmnnnApXAYs6kl38u2GBagU1PrC78m2Fo+bCiTRNTTqK8EP54wUNYg3LZ8JJfk8qG95Yl3cML8bg2iybXxIfWNCPvqJZxyGlMZ8tftxcQkFUo5rEu7mQT7GHqM5DxuTmNJ5dtI6TAP7IDnUAybrCp/d4flSiRUvdW7MSTf0Ro/PwK7Bt6gqWD6JYSyMI+zOeC3nAELGO4GiCRizqSXfy7YYFqBTU+sLvybYWj5sKJNE1NOorwQ/njBQ1iDctnwkl+Tyob3liXdwwvxuDaLJtfEh9Yz7CpKS0Vc4gg9r34xYljCVjt94p1MwOeTc+V84oIJrP5XN/qxPap5C8Ylqc1oBGsocIWJhOIjTSprPRn9EaKlzGdW7kwK6jc3zDgpn1xn2/g8ivGuYuR5EL/zy/ELCuISaA8PB72/tH3OQjfcrGEMAptaIz/WpdF4o/+3yqK7Pp2sg2AlyT8H5wiMLkhpJXBhckNJKhF0LXT58FOcsp0xZQfu5qSvWc3b9AJfSLau1eVpqxsI49c8GaNNwa6wpf6HpyWU/L9x+VYEG+v/aemYIbGcPAU/x1HAZibzSNk+H0OJ18OMVz5qxn1LeSxn+NCD5k5203/buFNzI47PR9N7Rl2A2R+lUUD1nLFPk32j+52XgGFAVQql4XKozsf+m4brcUXhGnG9IXB2a+6fQArS/zhEYXJDSSuDC5IaSVCLoWunz4Kc5ZTpiyg/dzUles5u36ASH07QcViA9hFavYvu+B10iw1JYFHVkuNa/W3lWBBvr/2npmjzwfwiRKaEGwBOErwthzVFTLLvhxehsGl2YxloEOogPd/JzU9TwBtIwFDEz1QWH6YV6ZPjXrRQrcge6yA8nno9yc3W1sdvJnSctFIIeBZJHPRaytP7X3Ofb2Y4VxQWMpIZSpXQhZz8ZkKxKPKKjreXZ4bt/vg9V5j/3+rzjKliszlShQDcl9sMExzD4xHpUD8AC2ivQxaiTwq5NQlnXQtjLaUCZUosbuokKCyh16q9ufM/axSxzSmAAAAAAA',
      deeplink: function (url) { return 'https://bkcode.vip?action=dapp&url=' + encodeURIComponent(url); },
      install: 'https://web3.bitget.com/en/wallet-download'
    },
    {
      name: 'Rabby Wallet', match: 'rabby', rdns: 'io.rabby', color: '#7084ff', letter: 'R', icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwXzc0MV8yNzUxKSI+CjxtYXNrIGlkPSJtYXNrMF83NDFfMjc1MSIgc3R5bGU9Im1hc2stdHlwZTpsdW1pbmFuY2UiIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjAiIHk9IjAiIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+CjxwYXRoIGQ9Ik0zMiAxNkMzMiA3LjE2MzQ0IDI0LjgzNjYgMCAxNiAwQzcuMTYzNDQgMCAwIDcuMTYzNDQgMCAxNkMwIDI0LjgzNjYgNy4xNjM0NCAzMiAxNiAzMkMyNC44MzY2IDMyIDMyIDI0LjgzNjYgMzIgMTZaIiBmaWxsPSJ3aGl0ZSIvPgo8L21hc2s+CjxnIG1hc2s9InVybCgjbWFzazBfNzQxXzI3NTEpIj4KPHBhdGggZD0iTTMyIDE2QzMyIDcuMTYzNDQgMjQuODM2NiAwIDE2IDBDNy4xNjM0NCAwIDAgNy4xNjM0NCAwIDE2QzAgMjQuODM2NiA3LjE2MzQ0IDMyIDE2IDMyQzI0LjgzNjYgMzIgMzIgMjQuODM2NiAzMiAxNloiIGZpbGw9IiM3MDg0RkYiLz4KPGcgZmlsdGVyPSJ1cmwoI2ZpbHRlcjBfZF83NDFfMjc1MSkiPgo8cGF0aCBkPSJNMjcuNjAxOSAxNy4zODc2QzI4LjUyMTYgMTUuMzI2MSAyMy45NzQ4IDkuNTY2MzIgMTkuNjMxIDcuMTY2NzZDMTYuODkyOSA1LjMwNzc5IDE0LjAzOTkgNS41NjMxOCAxMy40NjIgNi4zNzkzOEMxMi4xOTQgOC4xNzA2OSAxNy42NjExIDkuNjg4NTEgMjEuMzE3NCAxMS40NTk3QzIwLjUzMTQgMTEuODAyMiAxOS43OTA4IDEyLjQxNjkgMTkuMzU1MiAxMy4yMDI5QzE3Ljk5MjEgMTEuNzA5OCAxNS4wMDAzIDEwLjQyMzkgMTEuNDg5NyAxMS40NTk3QzkuMTIzOTcgMTIuMTU3NyA3LjE1NzkxIDEzLjgwMzIgNi4zOTgwNCAxNi4yODg1QzYuMjEzMzcgMTYuMjA2MiA2LjAwODk0IDE2LjE2MDQgNS43OTM4NyAxNi4xNjA0QzQuOTcxNDIgMTYuMTYwNCA0LjMwNDY5IDE2LjgyOTQgNC4zMDQ2OSAxNy42NTQ2QzQuMzA0NjkgMTguNDc5OSA0Ljk3MTQyIDE5LjE0ODggNS43OTM4NyAxOS4xNDg4QzUuOTQ2MzIgMTkuMTQ4OCA2LjQyMjk4IDE5LjA0NjMgNi40MjI5OCAxOS4wNDYzTDE0LjAzOTkgMTkuMTAxNkMxMC45OTM3IDIzLjk1MDQgOC41ODYzNSAyNC42NTkxIDguNTg2MzUgMjUuNDk5MkM4LjU4NjM1IDI2LjMzOTIgMTAuODg5OCAyNi4xMTE2IDExLjc1NDcgMjUuNzk4NEMxNS44OTQ5IDI0LjI5OTUgMjAuMzQxNyAxOS42MjggMjEuMTA0OCAxOC4yODMzQzI0LjMwOTIgMTguNjg0NCAyNy4wMDIyIDE4LjczMTggMjcuNjAxOSAxNy4zODc2WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzc0MV8yNzUxKSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTIxLjMwMjkgMTEuNDUzOEMyMS4zMDY3IDExLjQ1NTUgMjEuMzEwNiAxMS40NTcxIDIxLjMxNDQgMTEuNDU4OEMyMS40ODM5IDExLjM5MTggMjEuNDU2NSAxMS4xNDA3IDIxLjQwOTkgMTAuOTQzNUMyMS4zMDMgMTAuNDkwMSAxOS40NTc1IDguNjYxNjUgMTcuNzI0NSA3Ljg0MjY1QzE1LjM2MjkgNi43MjY2NSAxMy42MjQgNi43ODQyMSAxMy4zNjcyIDcuMjk4NjVDMTMuODQ3MiA4LjI4ODIxIDE2LjA3NzkgOS4yMTcyNyAxOC40MDc3IDEwLjE4NzZDMTkuMzk3MSAxMC41OTk2IDIwLjQwNDMgMTEuMDE5MSAyMS4zMDI5IDExLjQ1MzhaIiBmaWxsPSJ1cmwoI3BhaW50MV9saW5lYXJfNzQxXzI3NTEpIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTguMzIyOCAyMS40MTY3QzE3Ljg0NTMgMjEuMjMzNyAxNy4zMDYgMjEuMDY1OCAxNi42OTI5IDIwLjkxMzNDMTcuMzQ2OSAxOS43MzkzIDE3LjQ4NDEgMTguMDAxMSAxNi44NjY1IDE2LjkwMjJDMTUuOTk5OCAxNS4zNTk5IDE0LjkxMTcgMTQuNTM5MSAxMi4zODM0IDE0LjUzOTFDMTAuOTkyOCAxNC41MzkxIDcuMjQ4NzcgMTUuMDA5IDcuMTgyMjcgMTguMTQ1QzcuMTc1MzQgMTguNDczOCA3LjE4MjA5IDE4Ljc3NTEgNy4yMDU3NyAxOS4wNTIxTDE0LjA0MyAxOS4xMDE5QzEzLjEyMSAyMC41Njk0IDEyLjI1NzUgMjEuNjU3NyAxMS41MDE2IDIyLjQ4NTJDMTIuNDA5MiAyMi43MTg2IDEzLjE1ODEgMjIuOTE0NCAxMy44NDU3IDIzLjA5NDNDMTQuNDk3OCAyMy4yNjQ4IDE1LjA5NDYgMjMuNDIwOSAxNS43MTkzIDIzLjU4MDlDMTYuNjYyIDIyLjg5MTggMTcuNTQ4MyAyMi4xNDA0IDE4LjMyMjggMjEuNDE2N1oiIGZpbGw9InVybCgjcGFpbnQyX2xpbmVhcl83NDFfMjc1MSkiLz4KPHBhdGggZD0iTTYuMzA4NzQgMTguNzI4M0M2LjU4ODA1IDIxLjExMDUgNy45MzczNiAyMi4wNDQxIDEwLjY5NDYgMjIuMzIwNUMxMy40NTE5IDIyLjU5NjggMTUuMDMzNSAyMi40MTE0IDE3LjEzOTEgMjIuNjAzNkMxOC44OTc3IDIyLjc2NDEgMjAuNDY4IDIzLjY2MzMgMjEuMDUwNSAyMy4zNTI2QzIxLjU3NDcgMjMuMDczIDIxLjI4MTQgMjIuMDYyNiAyMC41Nzk5IDIxLjQxNDRDMTkuNjcwNiAyMC41NzQxIDE4LjQxMjEgMTkuOTkgMTYuMTk3NyAxOS43ODI2QzE2LjYzOSAxOC41NzAyIDE2LjUxNTQgMTYuODcwMyAxNS44Mjk5IDE1Ljk0NTVDMTQuODM4OSAxNC42MDgyIDEzLjAwOTcgMTQuMDAzNiAxMC42OTQ2IDE0LjI2NzhDOC4yNzU4NiAxNC41NDM4IDUuOTU4MjEgMTUuNzM4NiA2LjMwODc0IDE4LjcyODNaIiBmaWxsPSJ1cmwoI3BhaW50M19saW5lYXJfNzQxXzI3NTEpIi8+CjwvZz4KPC9nPgo8L2c+CjxkZWZzPgo8ZmlsdGVyIGlkPSJmaWx0ZXIwX2RfNzQxXzI3NTEiIHg9Ii03Ny42MTUzIiB5PSItNzYuMTYwMiIgd2lkdGg9IjE4Ny4yNTQiIGhlaWdodD0iMTg0LjE2MiIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz4KPGZlT2Zmc2V0Lz4KPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iNDAuOTYiLz4KPGZlQ29tcG9zaXRlIGluMj0iaGFyZEFscGhhIiBvcGVyYXRvcj0ib3V0Ii8+CjxmZUNvbG9yTWF0cml4IHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAuMTUxOTMzIDAgMCAwIDAgMC4yMzkyMzggMCAwIDAgMCAwLjQ5MDI0MSAwIDAgMCAwLjU0IDAiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJlZmZlY3QxX2Ryb3BTaGFkb3dfNzQxXzI3NTEiLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJlZmZlY3QxX2Ryb3BTaGFkb3dfNzQxXzI3NTEiIHJlc3VsdD0ic2hhcGUiLz4KPC9maWx0ZXI+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl83NDFfMjc1MSIgeDE9IjExLjIxNDIiIHkxPSIxNS41NjIiIHgyPSIyNy40MTE5IiB5Mj0iMjAuMTM5OSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSJ3aGl0ZSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IndoaXRlIi8+CjwvbGluZWFyR3JhZGllbnQ+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQxX2xpbmVhcl83NDFfMjc1MSIgeDE9IjI0LjY3NDUiIHkxPSIxNS4yNTE4IiB4Mj0iMTIuOTUzNiIgeTI9IjMuNTQxNjMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzg2OTdGRiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM4Njk3RkYiIHN0b3Atb3BhY2l0eT0iMCIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50Ml9saW5lYXJfNzQxXzI3NTEiIHgxPSIxOC42NDc4IiB5MT0iMjEuODI2MSIgeDI9IjcuNDA4MDIiIHkyPSIxNS4zODU5IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IiM4Njk3RkYiLz4KPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjODY5N0ZGIiBzdG9wLW9wYWNpdHk9IjAiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDNfbGluZWFyXzc0MV8yNzUxIiB4MT0iMTIuMTgyNyIgeTE9IjE1LjQzOTQiIHgyPSIxOS43OTkxIiB5Mj0iMjUuMDg0MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSJ3aGl0ZSIvPgo8c3RvcCBvZmZzZXQ9IjAuOTgzODk1IiBzdG9wLWNvbG9yPSIjRDFEOEZGIi8+CjwvbGluZWFyR3JhZGllbnQ+CjxjbGlwUGF0aCBpZD0iY2xpcDBfNzQxXzI3NTEiPgo8cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9IndoaXRlIi8+CjwvY2xpcFBhdGg+CjwvZGVmcz4KPC9zdmc+Cg==',
      install: 'https://rabby.io/'
    }
  ];

  let modalView = 'list';      // 'list' | 'connecting'
  let modalRetry = null;
  let modalKeyHandler = null;
  let connectToken = 0;
  let scrollLocked = false;
  let prevHtmlOverflow = '';

  function svgChevron() {
    return '<svg class="axw-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function svgSearch() {
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.6"/><path d="m10.6 10.6 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  function svgBrowser() {
    return '<svg width="100%" height="100%" viewBox="0 0 34 34" fill="none" aria-hidden="true"><rect width="34" height="34" fill="#dfe7ff"/><rect x="7" y="9" width="20" height="16" rx="3" stroke="#3d5bd9" stroke-width="1.7"/><path d="M7 14h20" stroke="#3d5bd9" stroke-width="1.7"/><circle cx="10.6" cy="11.5" r=".9" fill="#3d5bd9"/><circle cx="13.4" cy="11.5" r=".9" fill="#3d5bd9"/></svg>';
  }

  function ensureWalletModalStyles() {
    if (document.getElementById('axiverse-wallet-style')) return;
    const style = document.createElement('style');
    style.id = 'axiverse-wallet-style';
    style.textContent = `
      .axw-backdrop{--axw-bg:#fafaf6;--axw-ink:#12140f;--axw-mute:#7b7d75;--axw-line:rgba(18,20,15,.09);--axw-hover:rgba(18,20,15,.05);--axw-soft:#efefe9;--axw-ok:#13894c;--axw-ok-bg:#dcf5e5;--axw-err:#c8352a;
        position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;
        background:rgba(10,12,8,.42);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);
        font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;animation:axwFade .18s ease both}
      .axw-backdrop.axw-out{animation:axwFadeOut .16s ease both;pointer-events:none}
      .axw-backdrop *{box-sizing:border-box}
      .axw-modal{width:360px;max-width:100%;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;
        background:var(--axw-bg);color:var(--axw-ink);border:1px solid var(--axw-line);border-radius:26px;
        box-shadow:0 24px 80px rgba(0,0,0,.30);padding:6px 10px 10px;outline:none;
        animation:axwPop .24s cubic-bezier(.2,.9,.3,1.05) both}

      .axw-head{display:grid;grid-template-columns:36px 1fr 36px;align-items:center;height:54px}
      .axw-title{text-align:center;font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .axw-hbtn{width:34px;height:34px;border:0;border-radius:11px;background:transparent;color:var(--axw-mute);display:grid;place-items:center;cursor:pointer;padding:0;transition:background .12s,color .12s}
      .axw-hbtn:hover{background:var(--axw-hover);color:var(--axw-ink)}
      .axw-hbtn.axw-hidden{visibility:hidden;pointer-events:none}

      .axw-list{display:flex;flex-direction:column;gap:2px}
      .axw-list[hidden],.axw-connecting[hidden],.axw-btn[hidden],.axw-notice[hidden]{display:none}
      .axw-row{width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:0 12px;border:0;border-radius:16px;
        background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .12s,transform .08s}
      .axw-row:hover{background:var(--axw-hover)}
      .axw-row:active{transform:scale(.985)}
      .axw-row:focus-visible,.axw-hbtn:focus-visible,.axw-btn:focus-visible{outline:2px solid rgba(18,20,15,.4);outline-offset:-2px}
      .axw-ico{width:34px;height:34px;flex:0 0 34px;border-radius:10px;overflow:hidden;display:grid;place-items:center;background:var(--axw-soft);box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
      .axw-ico img{width:100%;height:100%;object-fit:cover;display:block}
      .axw-mono{width:100%;height:100%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:15px}
      .axw-name{flex:1;min-width:0;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .axw-tag{flex:0 0 auto;font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1;color:var(--axw-ok);background:var(--axw-ok-bg);border-radius:6px;padding:5px 7px}
      .axw-chev{flex:0 0 auto;color:#a2a49b}
      .axw-row.axw-search{margin-top:6px;background:var(--axw-soft)}
      .axw-row.axw-search:hover{background:#e7e7df}
      .axw-search .axw-ico{background:#e2e2da;color:#5d5f57;box-shadow:none}
      .axw-count{flex:0 0 auto;font-size:11px;font-weight:600;color:var(--axw-mute);background:rgba(18,20,15,.06);border-radius:8px;padding:4px 8px;line-height:1}

      .axw-notice{margin:8px 2px 0;padding:10px 12px;border-radius:12px;background:#fdecea;color:#a3271b;font-size:12px;line-height:1.45}

      .axw-connecting{display:flex;flex-direction:column;align-items:center;text-align:center;padding:14px 14px 6px}
      .axw-orb{position:relative;width:92px;height:92px;margin-bottom:18px;display:grid;place-items:center}
      .axw-orb .axw-ico{width:60px;height:60px;flex:none;border-radius:18px}
      .axw-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(18,20,15,.09);border-top-color:var(--axw-ink);animation:axwSpin .9s linear infinite}
      .axw-connecting.is-error .axw-ring{animation:none;border-color:var(--axw-err)}
      .axw-connecting.is-error .axw-orb{animation:axwShake .4s ease}
      .axw-ct{font-size:16px;font-weight:600;letter-spacing:-.01em}
      .axw-cs{margin-top:6px;font-size:13px;line-height:1.5;color:var(--axw-mute);max-width:280px}
      .axw-connecting.is-error .axw-cs{color:var(--axw-err)}
      .axw-btn{margin-top:18px;border:0;border-radius:999px;background:var(--axw-ink);color:#fff;font:inherit;font-size:13px;font-weight:600;padding:11px 22px;cursor:pointer;transition:opacity .12s}
      .axw-btn:hover{opacity:.86}

      .axw-foot{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 4px 6px;font-size:11px;color:var(--axw-mute)}
      .axw-chip{display:inline-flex;align-items:center;gap:6px;background:var(--axw-soft);color:#3a3c35;border-radius:999px;padding:5px 10px;font-weight:600}
      .axw-chip i{width:6px;height:6px;border-radius:50%;background:#1fbf6b}

      .axw-menu{position:fixed;z-index:99998;min-width:190px;background:#fafaf6;border:1px solid rgba(18,20,15,.1);border-radius:16px;
        box-shadow:0 18px 50px rgba(0,0,0,.2);padding:6px;color:#12140f;animation:axwPop .16s ease both}
      .axw-menu button{display:block;width:100%;border:0;background:transparent;text-align:left;padding:11px 12px;border-radius:11px;font:inherit;font-size:12px;font-weight:700;letter-spacing:.05em;cursor:pointer;color:#12140f}
      .axw-menu button:hover{background:rgba(18,20,15,.06)}
      .axw-menu .axw-danger{color:#b02a20}
      .axw-menu .axw-danger:hover{background:#fdecea}

      @keyframes axwFade{from{opacity:0}to{opacity:1}}
      @keyframes axwFadeOut{from{opacity:1}to{opacity:0}}
      @keyframes axwPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
      @keyframes axwSpin{to{transform:rotate(360deg)}}
      @keyframes axwShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
      @media (prefers-reduced-motion:reduce){.axw-backdrop,.axw-modal,.axw-menu,.axw-orb{animation:none!important}}
      @media (max-width:420px){.axw-modal{border-radius:24px}}

      #profileGate.hidden,#profileContent.hidden{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function lockScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    prevHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.documentElement.style.overflow = prevHtmlOverflow;
  }

  function closeConnectModal(immediate) {
    if (modalKeyHandler) {
      document.removeEventListener('keydown', modalKeyHandler);
      modalKeyHandler = null;
    }
    unlockScroll();
    const el = document.getElementById('axiverse-wallet-modal');
    if (!el) return;
    connectToken++; // ignore results of any connection attempt started from this modal
    if (immediate === true) { el.remove(); return; }
    el.removeAttribute('id');
    el.classList.add('axw-out');
    setTimeout(function () { el.remove(); }, 170);
  }

  function openConnectModal() {
    ensureWalletModalStyles();
    closeConnectModal(true);
    modalView = 'list';
    modalRetry = null;
    createConnectModal();
    requestProviders();
    renderWalletModal();
    setTimeout(renderWalletModal, 80);
    setTimeout(renderWalletModal, 400);
  }

  function createConnectModal() {
    ensureWalletModalStyles();
    const backdrop = document.createElement('div');
    backdrop.id = 'axiverse-wallet-modal';
    backdrop.className = 'axw-backdrop';
    backdrop.innerHTML = `
      <div class="axw-modal" role="dialog" aria-modal="true" aria-label="Connect wallet" tabindex="-1">
        <div class="axw-head">
          <button class="axw-hbtn axw-back axw-hidden" type="button" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="axw-title">Connect Wallet</div>
          <button class="axw-hbtn axw-close" type="button" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2.5 2.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="axw-body">
          <div class="axw-list"></div>
          <div class="axw-connecting" hidden>
            <div class="axw-orb"><div class="axw-ring"></div><span class="axw-ico axw-orb-ico"></span></div>
            <div class="axw-ct" aria-live="polite"></div>
            <div class="axw-cs"></div>
            <button class="axw-btn" type="button" hidden></button>
          </div>
          <div class="axw-notice" role="alert" hidden></div>
        </div>
        <div class="axw-foot"><span>Network</span><span class="axw-chip"><i></i>${escapeHtml(CONFIG.CHAIN_NAME)}</span></div>
      </div>`;

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeConnectModal();
    });
    backdrop.querySelector('.axw-close').addEventListener('click', function () { closeConnectModal(); });
    backdrop.querySelector('.axw-back').addEventListener('click', backToList);
    backdrop.querySelector('.axw-btn').addEventListener('click', function () {
      if (typeof modalRetry === 'function') modalRetry();
    });

    modalKeyHandler = function (e) {
      if (e.key === 'Escape') closeConnectModal();
    };
    document.addEventListener('keydown', modalKeyHandler);

    lockScroll();
    document.body.appendChild(backdrop);
    try { backdrop.querySelector('.axw-modal').focus({ preventScroll: true }); } catch (e) {}
    return backdrop;
  }

  function currentModal() {
    return document.getElementById('axiverse-wallet-modal');
  }

  function rowIconHtml(row) {
    if (row.icon) return '<img src="' + escapeHtml(row.icon) + '" alt="">';
    if (row.generic) return svgBrowser();
    const letter = row.letter || String(row.name || 'W').charAt(0).toUpperCase();
    return '<span class="axw-mono" style="background:' + (row.color || '#8d8f86') + '">' + escapeHtml(letter) + '</span>';
  }

  function buildRows() {
    const detected = getWalletChoices().map(function (choice) {
      const info = choice.info || {};
      return {
        kind: 'installed',
        name: walletName(info),
        icon: info.icon || '',
        rdns: String(info.rdns || '').toLowerCase(),
        generic: info.rdns === 'browser.injected',
        choice: choice
      };
    });
    // Named wallets first, the generic "Browser Wallet" after them.
    detected.sort(function (a, b) { return (a.generic ? 1 : 0) - (b.generic ? 1 : 0); });

    const extras = POPULAR_WALLETS.filter(function (p) {
      return !detected.some(function (d) {
        return d.rdns === p.rdns || d.name.toLowerCase().indexOf(p.match) !== -1;
      });
    }).map(function (p) {
      return Object.assign({ kind: 'external' }, p);
    });

    return detected.concat(extras).slice(0, Math.max(MODAL_MAX_ROWS, detected.length));
  }

  function renderWalletModal() {
    const modal = currentModal();
    if (!modal || modalView !== 'list') return;
    const list = modal.querySelector('.axw-list');
    if (!list) return;
    list.innerHTML = '';

    buildRows().forEach(function (row) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'axw-row';
      btn.innerHTML =
        '<span class="axw-ico">' + rowIconHtml(row) + '</span>' +
        '<span class="axw-name">' + escapeHtml(row.name) + '</span>' +
        (row.kind === 'installed' ? '<span class="axw-tag">Installed</span>' : '') +
        svgChevron();
      btn.addEventListener('click', function () { onWalletRow(row); });
      list.appendChild(btn);
    });

    if (CONFIG.REOWN_PROJECT_ID) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'axw-row axw-search';
      more.innerHTML =
        '<span class="axw-ico">' + svgSearch() + '</span>' +
        '<span class="axw-name">Search Wallet</span>' +
        '<span class="axw-count">WalletConnect</span>' +
        svgChevron();
      more.addEventListener('click', startReown);
      list.appendChild(more);
    }
  }

  function setListNotice(message) {
    const modal = currentModal();
    if (!modal) return;
    const box = modal.querySelector('.axw-notice');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }

  function showConnecting(opts) {
    const modal = currentModal();
    if (!modal) return;
    modalView = 'connecting';
    modalRetry = opts.onRetry || null;
    setListNotice('');

    modal.querySelector('.axw-list').hidden = true;
    const box = modal.querySelector('.axw-connecting');
    box.hidden = false;
    box.classList.remove('is-error');
    box.querySelector('.axw-orb-ico').innerHTML = opts.iconHtml || '';
    box.querySelector('.axw-ct').textContent = opts.title || '';
    box.querySelector('.axw-cs').textContent = opts.sub || '';
    const retry = box.querySelector('.axw-btn');
    retry.hidden = !opts.retryLabel;
    retry.textContent = opts.retryLabel || '';

    modal.querySelector('.axw-back').classList.remove('axw-hidden');
    modal.querySelector('.axw-title').textContent = opts.heading || 'Connect Wallet';
  }

  function showConnectError(error) {
    const modal = currentModal();
    if (!modal || modalView !== 'connecting') return;
    const box = modal.querySelector('.axw-connecting');
    box.classList.add('is-error');
    box.querySelector('.axw-ct').textContent = isDeclined(error) ? 'Request declined' : 'Connection failed';
    box.querySelector('.axw-cs').textContent = friendlyError(error);
    const retry = box.querySelector('.axw-btn');
    retry.hidden = false;
    retry.textContent = 'Try again';
  }

  function backToList() {
    const modal = currentModal();
    if (!modal) return;
    connectToken++;
    modalView = 'list';
    modalRetry = null;
    modal.querySelector('.axw-connecting').hidden = true;
    modal.querySelector('.axw-list').hidden = false;
    modal.querySelector('.axw-back').classList.add('axw-hidden');
    modal.querySelector('.axw-title').textContent = 'Connect Wallet';
    renderWalletModal();
  }

  function isDeclined(error) {
    const raw = error && error.message ? error.message : String(error || '');
    return !!(error && error.code === 4001) || /user (rejected|denied|cancel)|rejected the request|declined|denied/i.test(raw);
  }

  function friendlyError(error) {
    const raw = error && error.message ? error.message : String(error || '');
    if (isDeclined(error)) return 'You declined the connection request in your wallet.';
    if (error && error.code === -32002 || /already pending/i.test(raw)) return 'A request is already open. Open your wallet to continue.';
    if (/dynamically imported module|importing a module|failed to fetch/i.test(raw)) return 'Could not load WalletConnect. Check your connection and try again.';
    return raw || 'Wallet connection failed.';
  }

  function onWalletRow(row) {
    if (row.kind === 'installed') return connectRow(row);
    if (isMobile() && row.deeplink) return openInWalletApp(row);
    if (CONFIG.REOWN_PROJECT_ID) return startReown();
    if (row.install) window.open(row.install, '_blank', 'noopener');
  }

  function connectRow(row) {
    const token = ++connectToken;
    showConnecting({
      heading: row.name,
      iconHtml: rowIconHtml(row),
      title: 'Continue in ' + row.name,
      sub: 'Accept the connection request in your wallet.',
      onRetry: function () { connectRow(row); }
    });
    connectInjected(row.choice.provider, row.choice.info).then(function () {
      if (token === connectToken) closeConnectModal();
    }).catch(function (error) {
      console.warn('[Axiverse Wallet]', error);
      if (token === connectToken) showConnectError(error);
    });
  }

  function openInWalletApp(row) {
    ++connectToken;
    showConnecting({
      heading: row.name,
      iconHtml: rowIconHtml(row),
      title: 'Opening ' + row.name,
      sub: 'Axiverse opens inside the ' + row.name + ' app. If nothing happens, install the app first.',
      retryLabel: 'Open again',
      onRetry: function () { openInWalletApp(row); }
    });
    setTimeout(function () {
      window.location.href = row.deeplink(window.location.href);
    }, 200);
  }

  function startReown() {
    // WalletConnect draws its own QR / wallet-search sheet, so ours must be out of the way.
    closeConnectModal(true);
    connectWithReown().catch(function (error) {
      console.warn('[Axiverse Wallet]', error);
      const message = friendlyError(error);
      openConnectModal();
      // Closing the WalletConnect sheet is not an error worth showing.
      if (!/reset|closed|cancel/i.test(message)) setListNotice(message);
    });
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
    console.error('[Axiverse Wallet]', error);
    if (!currentModal()) return;
    if (modalView === 'connecting') showConnectError(error);
    else setListNotice(friendlyError(error));
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
