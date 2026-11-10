/* ============================================================
   首页左上横幅：全球宏观指标看板（常驻显示）
   - 数据源：/api/macro（Cloudflare Pages Function 代理 FRED）
   - 每 30 分钟刷新一次
   ============================================================ */
(function () {
  "use strict";

  var REFRESH_MS = 30 * 60 * 1000;

  // 指标顺序即展示顺序：上排利率，下排通胀与就业
  var TILES = [
    { key: "dgs10", label: "美债 10Y", kind: "yield" },
    { key: "dgs2", label: "美债 2Y", kind: "yield" },
    { key: "spread", label: "10Y-2Y 利差", kind: "spread" },
    { key: "cpi", label: "CPI 同比", kind: "cpi" },
    { key: "nfp", label: "非农就业", kind: "nfp" },
    { key: "icsa", label: "初请失业金", kind: "icsa" }
  ];

  var root = null;
  var gridEl = null;
  var updatedEl = null;
  var refreshTimer = null;
  var busy = false;

  /* ---------------- 格式化 ---------------- */

  function signed(n, digits) {
    var s = Math.abs(n).toFixed(digits);
    return (n > 0 ? "+" : n < 0 ? "-" : "") + s;
  }

  function tone(n) {
    if (n > 0.0000001) return "mb-up";
    if (n < -0.0000001) return "mb-down";
    return "mb-flat";
  }

  function shortDate(d, monthly) {
    if (!d) return "";
    return monthly ? d.slice(0, 7) : d.slice(5);
  }

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  // 数值 + 小号单位，形成层次（如 4.128 与 %）
  function setValue(node, num, unit, cls) {
    node.className = "mb-value" + (cls ? " " + cls : "");
    while (node.firstChild) node.removeChild(node.firstChild);
    node.appendChild(document.createTextNode(num));
    if (unit) node.appendChild(el("span", "mb-unit", unit));
  }

  /* ---------------- 渲染 ---------------- */

  function buildTile(cfg, item) {
    var tile = el("div", "mb-tile");
    tile.appendChild(el("div", "mb-label", cfg.label));

    if (!item || item.value === null || item.value === undefined) {
      tile.className = "mb-tile is-empty";
      tile.appendChild(el("div", "mb-value", "—"));
      tile.appendChild(el("div", "mb-note", "暂无数据"));
      return tile;
    }

    var v = item.value;
    var prev = item.prev;
    var hasPrev = prev !== null && prev !== undefined;
    var valueEl = el("div", "mb-value");
    var noteEl = el("div", "mb-note");

    switch (cfg.kind) {
      case "yield": {
        setValue(valueEl, v.toFixed(3), "%");
        if (hasPrev) {
          var bp = (v - prev) * 100;
          noteEl.className = "mb-note " + tone(bp);
          noteEl.textContent =
            (bp > 0 ? "▲ " : bp < 0 ? "▼ " : "") +
            Math.abs(bp).toFixed(1) +
            "bp · " +
            shortDate(item.date, false);
        } else {
          noteEl.textContent = shortDate(item.date, false);
        }
        break;
      }

      case "spread": {
        setValue(valueEl, (v > 0 ? "+" : "") + v.toFixed(2), "%");
        var state = v < 0 ? "倒挂" : "正常";
        if (hasPrev) {
          var dbp = (v - prev) * 100;
          noteEl.className = "mb-note " + tone(dbp);
          noteEl.textContent = state + " · " + shortDate(item.date, false);
        } else {
          noteEl.textContent = state;
        }
        break;
      }

      case "cpi": {
        setValue(valueEl, v.toFixed(1), "%");
        if (hasPrev) {
          var dpp = v - prev;
          noteEl.className = "mb-note " + tone(dpp);
          noteEl.textContent =
            "前值 " + prev.toFixed(1) + "% · " + shortDate(item.date, true);
        } else {
          noteEl.textContent = shortDate(item.date, true);
        }
        break;
      }

      case "nfp": {
        var wan = v / 10;
        setValue(valueEl, signed(wan, 1), "万", tone(wan));
        noteEl.textContent = hasPrev
          ? "前值 " + signed(prev / 10, 1) + " 万 · " + shortDate(item.date, true)
          : shortDate(item.date, true);
        break;
      }

      default: {
        // 初请失业金：单位「人」，折算为万
        setValue(valueEl, (v / 10000).toFixed(1), "万");
        if (hasPrev) {
          var diff = v - prev;
          noteEl.className = "mb-note " + tone(diff);
          noteEl.textContent =
            "前值 " + (prev / 10000).toFixed(1) + " 万 · " + shortDate(item.date, false);
        } else {
          noteEl.textContent = shortDate(item.date, false);
        }
        break;
      }
    }

    tile.appendChild(valueEl);
    tile.appendChild(noteEl);
    return tile;
  }

  function render(items) {
    if (!gridEl) return;
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    TILES.forEach(function (cfg) {
      gridEl.appendChild(buildTile(cfg, items ? items[cfg.key] : null));
    });
  }

  function setUpdated(text, off) {
    if (!updatedEl) return;
    updatedEl.textContent = text;
    updatedEl.className = "mb-updated" + (off ? " is-off" : "");
  }

  /* ---------------- 数据 ---------------- */

  function stamp() {
    var d = new Date();
    var p = function (n) {
      return n < 10 ? "0" + n : "" + n;
    };
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function scheduleNext() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, REFRESH_MS);
  }

  function load() {
    if (busy || !root) return;
    busy = true;

    fetch("/api/macro", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!root) return;
        var items = (json && json.items) || {};
        if (!Object.keys(items).length) throw new Error("empty");
        render(items);
        setUpdated("更新 " + stamp(), false);
      })
      .catch(function () {
        if (!root) return;
        if (!gridEl || !gridEl.querySelector(".mb-tile:not(.is-skeleton)")) {
          render(null);
        }
        setUpdated("数据暂不可用", true);
      })
      .then(function () {
        busy = false;
        if (root) scheduleNext();
      });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    var board = document.getElementById("macro-board");
    if (!board) {
      teardown();
      return;
    }
    if (board.dataset.mbReady === "1" && root === board) return;

    root = board;
    root.dataset.mbReady = "1";
    gridEl = document.getElementById("mb-grid");
    updatedEl = document.getElementById("mb-updated");

    load();
  }

  function teardown() {
    root = null;
    gridEl = null;
    updatedEl = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
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
