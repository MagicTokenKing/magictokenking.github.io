/* ============================================================
   首页横幅悬浮层：永续合约资金费率
   - 优先请求同域代理 /api/funding（Cloudflare Pages Function，规避跨域与网络限制）
   - 失败时回退到 Binance 合约公共接口直连
   - 每 60 秒刷新一次，实时倒计时到下一次结算
   ============================================================ */
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  var SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

  var root = null;
  var bodyEl = null;
  var countdownEl = null;
  var sourceEl = null;
  var dotEl = null;

  var refreshTimer = null;
  var tickTimer = null;
  var rows = [];
  var busy = false;

  /* ---------------- 格式化 ---------------- */

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function fmtRate(rate) {
    if (rate === null || rate === undefined || isNaN(rate)) return "--";
    var v = rate * 100;
    var s = Math.abs(v).toFixed(4) + "%";
    return (v > 0 ? "+" : v < 0 ? "-" : "") + s;
  }

  function fmtAnnual(rate) {
    if (rate === null || rate === undefined || isNaN(rate)) return "--";
    var v = rate * 3 * 365 * 100;
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }

  function fmtPrice(p) {
    if (!p || isNaN(p)) return "--";
    var digits = p >= 1000 ? 2 : p >= 1 ? 3 : 5;
    var parts = p.toFixed(digits).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function dirClass(v) {
    if (v > 0) return "fr-up";
    if (v < 0) return "fr-down";
    return "fr-flat";
  }

  /* ---------------- 数据 ---------------- */

  function normalize(list) {
    var map = {};
    list.forEach(function (it) {
      var sym = (it.symbol || "").toUpperCase();
      if (SYMBOLS.indexOf(sym) === -1) return;
      var rate = parseFloat(it.rate !== undefined ? it.rate : it.lastFundingRate);
      var price = parseFloat(it.price !== undefined ? it.price : it.markPrice);
      var next = Number(it.nextFundingTime || it.next || 0);
      map[sym] = {
        symbol: sym,
        name: sym.replace(/USDT$/, ""),
        rate: isNaN(rate) ? null : rate,
        price: isNaN(price) ? null : price,
        next: next || 0
      };
    });
    var out = [];
    SYMBOLS.forEach(function (s) {
      if (map[s]) out.push(map[s]);
    });
    return out;
  }

  function fromProxy() {
    return fetch("/api/funding", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("proxy " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.items || !json.items.length) throw new Error("empty");
        return { source: json.source || "边缘代理", items: normalize(json.items) };
      });
  }

  function fromBinance() {
    return fetch("https://fapi.binance.com/fapi/v1/premiumIndex", {
      cache: "no-store"
    })
      .then(function (r) {
        if (!r.ok) throw new Error("binance " + r.status);
        return r.json();
      })
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error("bad payload");
        return { source: "Binance 直连", items: normalize(list) };
      });
  }

  function fetchData() {
    return fromProxy()
      .then(function (res) {
        if (!res.items.length) throw new Error("empty");
        return res;
      })
      .catch(function () {
        return fromBinance();
      });
  }

  /* ---------------- 渲染 ---------------- */

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function cell(text, cls) {
    var d = document.createElement("div");
    d.className = cls || "";
    d.textContent = text;
    return d;
  }

  function render(items, source) {
    if (!bodyEl) return;
    clear(bodyEl);

    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "fr-row";

      var sym = document.createElement("div");
      sym.className = "fr-sym";
      sym.appendChild(document.createTextNode(it.name));
      var em = document.createElement("em");
      em.textContent = "/USDT";
      sym.appendChild(em);

      var rate = cell(fmtRate(it.rate), "fr-rate " + dirClass(it.rate));
      rate.title = "多空双方每 8 小时互相支付的费率";
      var annual = cell(fmtAnnual(it.rate), "fr-annual " + dirClass(it.rate));
      annual.title = "按每 8 小时结算折算的年化";
      var price = cell(fmtPrice(it.price), "fr-price");

      row.appendChild(sym);
      row.appendChild(rate);
      row.appendChild(annual);
      row.appendChild(price);
      bodyEl.appendChild(row);
    });

    if (sourceEl) sourceEl.textContent = "数据来源 · " + source;
    if (dotEl) dotEl.classList.remove("is-off");
    tick();
  }

  function renderEmpty(msg) {
    if (!bodyEl) return;
    clear(bodyEl);
    var d = document.createElement("div");
    d.className = "fr-empty";
    d.textContent = msg;
    bodyEl.appendChild(d);
    if (dotEl) dotEl.classList.add("is-off");
    if (sourceEl) sourceEl.textContent = "数据来源 · 暂不可用";
  }

  function tick() {
    if (!countdownEl) return;
    var now = Date.now();
    var next = 0;
    rows.forEach(function (r) {
      if (r.next && r.next > now && (!next || r.next < next)) next = r.next;
    });
    if (!next) {
      countdownEl.textContent = "结算 --:--:--";
      return;
    }
    var left = Math.max(0, Math.floor((next - now) / 1000));
    var h = Math.floor(left / 3600);
    var m = Math.floor((left % 3600) / 60);
    var s = left % 60;
    countdownEl.textContent = "结算 " + pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  /* ---------------- 流程 ---------------- */

  function scheduleNext() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, REFRESH_MS);
  }

  function load() {
    if (busy || !root) return;
    busy = true;
    fetchData()
      .then(function (res) {
        if (!root) return;
        rows = res.items;
        render(res.items, res.source);
      })
      .catch(function () {
        if (!root) return;
        if (!rows.length) renderEmpty("行情接口暂不可用");
        else if (dotEl) dotEl.classList.add("is-off");
      })
      .then(function () {
        busy = false;
        if (root) scheduleNext();
      });
  }

  function bindTouch() {
    var banner = document.getElementById("random-banner");
    if (!banner || banner.dataset.frTouch === "1") return;
    banner.dataset.frTouch = "1";
    banner.addEventListener("click", function (e) {
      if (!window.matchMedia || !window.matchMedia("(hover: none)").matches) return;
      if (!root) return;
      e.preventDefault();
      e.stopPropagation();
      root.classList.toggle("fr-open");
    });
  }

  function init() {
    var el = document.getElementById("random-hover");
    if (!el) {
      teardown();
      return;
    }
    if (el.dataset.frReady === "1") return;

    root = el;
    root.dataset.frReady = "1";
    bodyEl = document.getElementById("fr-body");
    countdownEl = document.getElementById("fr-countdown");
    sourceEl = document.getElementById("fr-source");
    dotEl = root.querySelector(".fr-live-dot");
    rows = [];

    bindTouch();
    load();

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
  }

  function teardown() {
    root = null;
    bodyEl = countdownEl = sourceEl = dotEl = null;
    rows = [];
    if (refreshTimer) clearTimeout(refreshTimer);
    if (tickTimer) clearInterval(tickTimer);
    refreshTimer = tickTimer = null;
  }

  document.addEventListener("pjax:send", teardown);
  document.addEventListener("pjax:complete", function () {
    window.setTimeout(init, 120);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
