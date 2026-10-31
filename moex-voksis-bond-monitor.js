(function () {
  const aliases = ["МКАОВокс01", "МКАОВокс02", "МКАОВокс03", "Воксис-01", "Воксис-02", "Воксис-03", "Воксис-04"];
  const knownSecids = new Map([
    ["МКАОВокс01", "RU000A10DCE0"], ["МКАОВокс02", "RU000A10E9Z7"],
    ["МКАОВокс03", "RU000A10GFW8"], ["Воксис-01", "RU000A10AC67"],
    ["Воксис-02", "RU000A10B222"], ["Воксис-03", "RU000A10BW39"],
    ["Воксис-04", "RU000A10C8K3"]
  ]);
  const apiBase = "https://iss.moex.com/iss";
  const floatingCoupons = new Set(["RU000A10AC67"]);
  const couponTerms = new Map([["RU000A10AC67", "КС + 7 п.п."]]);
  const edisclosureOptions = [
    {
      aliases: ["Воксис-01", "RU000A10AC67"],
      date: "2026-12-07",
      source: "https://www.e-disclosure.ru/portal/event.aspx?EventId=j4crP6Pt9U-Cd9nJu3wkZog-B-B"
    },
    {
      aliases: ["Воксис-02", "RU000A10B222"],
      date: "2026-03-10",
      source: "https://www.e-disclosure.ru/portal/event.aspx?EventId=q4S-A3ClKV0akMhzoFPcvyg-B-B"
    },
    {
      aliases: ["Воксис-03", "RU000A10BW39"],
      date: "2026-12-19",
      source: "https://www.e-disclosure.ru/portal/event.aspx?EventId=WiLxLnLHIU63blMrDCAV4A-B-B"
    }
  ];
  const rows = document.querySelector("#rows");
  const issueTotalRow = document.querySelector("#issueTotalRow");
  const totalOutstanding = document.querySelector("#totalOutstanding");
  const totalCouponRate = document.querySelector("#totalCouponRate");
  const totalCouponAmount = document.querySelector("#totalCouponAmount");
  const issueTotalNote = document.querySelector("#issueTotalNote");
  const refreshButton = document.querySelector("#refreshButton");
  const intervalSelect = document.querySelector("#intervalSelect");
  const historyPeriodSelect = document.querySelector("#historyPeriodSelect");
  const historyPriceToggle = document.querySelector("#historyPriceToggle");
  const historyYieldToggle = document.querySelector("#historyYieldToggle");
  const reportDateInput = document.querySelector("#reportDateInput");
  const statusText = document.querySelector("#statusText");
  const statusDot = document.querySelector("#statusDot");
  const updatedAt = document.querySelector("#updatedAt");
  const historyCharts = document.querySelector("#historyCharts");
  const historyStatus = document.querySelector("#historyStatus");

  let refreshTimer = 0;
  let resolved = new Map();
  const snapshotRequests = new Map();
  let reportCache = new Map();
  const initialCouponCache = new Map();
  const initialCouponRates = new Map();
  let lastQuotes = [];
  let lastReportItems = [];
  let issuerFilter = "all";
  let keyRateDecisions = [];
  let keyRateLoadedAt = 0;
  let keyRateRequest = null;
  let reportRequestId = 0;
  let quoteRequest = null;

  function readSaved(key) {
    try {
      return JSON.parse(localStorage.getItem(`voxys-monitor:${key}`));
    } catch (_) {
      return null;
    }
  }

  function saveData(key, data) {
    try {
      localStorage.setItem(`voxys-monitor:${key}`, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {
      // Private browsing or a full storage quota must not block live data.
    }
  }

  async function loadKeyRates() {
    if (Date.now() - keyRateLoadedAt < 60 * 60 * 1000) return;
    if (!keyRateRequest) {
      keyRateRequest = fetch("https://kurs-rublya.ru/api/v1/key-rates/cbr/history/?limit=100")
        .then((response) => {
          if (!response.ok) throw new Error(`История ключевой ставки: ${response.status}`);
          return response.json();
        })
        .then((data) => {
          keyRateDecisions = Array.isArray(data.decisions) ? data.decisions : [];
          keyRateLoadedAt = Date.now();
          saveData("key-rates", keyRateDecisions);
        })
        .finally(() => { keyRateRequest = null; });
    }
    return keyRateRequest;
  }

  function getKeyRateOn(dateIso) {
    const decision = keyRateDecisions
      .filter((item) => item.effectiveDate <= dateIso)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    return decision && Number.isFinite(Number(decision.ratePercent))
      ? Number(decision.ratePercent) : null;
  }

  function getCouponTotal(item, reportDateIso) {
    if (item.secid !== "RU000A10AC67") return item.nextCouponTotal;
    const keyRate = getKeyRateOn(reportDateIso);
    if (keyRate == null || item.placedSize == null || item.faceValue == null) return null;
    const perBond = Math.round(item.faceValue * (keyRate + 7) * 30 / 365) / 100;
    return perBond * item.placedSize;
  }

  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(number);
  }

  function formatPercent(value, digits = 2) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return `${formatNumber(number, digits)}%`;
  }

  function formatSignedPercent(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    const sign = number > 0 ? "+" : "";
    return `${sign}${formatNumber(number, 1)}%`;
  }

  function formatCompact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return new Intl.NumberFormat("ru-RU", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(number);
  }

  function formatRub(value, digits = 0) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return `${new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(number)} ₽`;
  }

  function formatMillionsRub(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return `${formatNumber(number / 1000000, 2)} млн ₽`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = typeof value === "string" ? parseDate(value) : value;
    if (!date) return "-";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    }).format(date);
  }

  function formatChartMonth(value) {
    if (!value) return "-";
    const date = typeof value === "string" ? parseDate(value) : value;
    if (!date) return "-";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${month}/${String(date.getFullYear()).slice(-2)}`;
  }

  function formatDateLong(value) {
    if (!value) return "-";
    const date = typeof value === "string" ? parseDate(value) : value;
    if (!date) return "-";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatMaturityWithOption(maturityDate, optionDate) {
    const maturity = formatDateLong(maturityDate);
    const option = formatDateLong(optionDate);
    if (maturity === "-") return option;
    return option === "-" ? maturity : `${maturity} (${option})`;
  }

  function todayIso() {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function toIsoDate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).slice(0, 10));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function addDays(value, days) {
    const date = typeof value === "string" ? parseDate(value) : new Date(value);
    date.setDate(date.getDate() + days);
    return date;
  }

  function getMonthTicks(dateFrom, dateTo) {
    const ticks = [];
    const cursor = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
    if (cursor < dateFrom) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= dateTo) {
      ticks.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return ticks;
  }

  function pick(row, names) {
    for (const name of names) {
      if (row && row[name] !== undefined && row[name] !== null && row[name] !== "") {
        return row[name];
      }
    }
    return null;
  }

  function normalizeKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getEdisclosureOptionDate(alias, security, info) {
    const keys = [
      alias,
      security?.secid,
      pick(info, ["ISIN", "SECID", "BOARDID"])
    ].map(normalizeKey).filter(Boolean);

    const found = edisclosureOptions.find((item) => (
      item.aliases.some((value) => keys.includes(normalizeKey(value)))
    ));
    return found?.date || null;
  }

  function blockToRows(block) {
    if (!block || !Array.isArray(block.columns) || !Array.isArray(block.data)) return [];
    return block.data.map((item) => Object.fromEntries(block.columns.map((column, index) => [column, item[index]])));
  }

  async function getJson(url) {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(15000) : undefined;
    const response = await fetch(url, { cache: url.includes("/history/") ? "default" : "no-store", signal });
    if (!response.ok) throw new Error(`MOEX вернул ${response.status}`);
    return response.json();
  }

  async function getPagedRows(url, blockName) {
    const join = url.includes("?") ? "&" : "?";
    const first = await getJson(`${url}${join}start=0`);
    const rows = blockToRows(first[blockName]);
    const cursor = blockToRows(first[`${blockName}.cursor`])[0];
    if (!cursor || !rows.length) return rows;

    const total = Number(pick(cursor, ["TOTAL"])) || rows.length;
    const pageSize = Number(pick(cursor, ["PAGESIZE"])) || rows.length;
    const starts = [];
    for (let start = pageSize; start < total; start += pageSize) starts.push(start);
    for (let i = 0; i < starts.length; i += 4) {
      const pages = await Promise.all(starts.slice(i, i + 4).map(async (start) => {
        const json = await getJson(`${url}${join}start=${start}`);
        return blockToRows(json[blockName]);
      }));
      for (const page of pages) rows.push(...page);
    }
    return rows;
  }

  async function resolveAlias(alias) {
    if (resolved.has(alias)) return resolved.get(alias);
    if (knownSecids.has(alias)) {
      const result = { alias, secid: knownSecids.get(alias), shortname: alias, primaryBoard: "" };
      resolved.set(alias, result);
      return result;
    }
    const request = (async () => {
      const url = `${apiBase}/securities.json?q=${encodeURIComponent(alias)}&iss.meta=off`;
      const json = await getJson(url);
      const matches = blockToRows(json.securities);
      const found = matches
        .filter((item) => String(item.type || "").toLowerCase().includes("bond") || String(item.group || "").toLowerCase().includes("bond") || item.is_traded === 1)
        .find((item) => [item.secid, item.shortname, item.name, item.secname].some((value) => String(value || "").toLowerCase() === alias.toLowerCase()))
        || matches[0];

      return found ? {
        alias,
        secid: found.secid || alias,
        shortname: found.shortname || found.name || alias,
        primaryBoard: found.primary_boardid || found.boardid || ""
      } : { alias, secid: alias, shortname: alias, missing: true };
    })();
    resolved.set(alias, request);
    try {
      const result = await request;
      resolved.set(alias, result);
      return result;
    } catch (error) {
      resolved.delete(alias);
      throw error;
    }
  }

  async function loadSecuritySnapshot(security) {
    const cached = snapshotRequests.get(security.secid);
    if (cached && cached.expiresAt > Date.now()) return cached.request;
    const url = `${apiBase}/engines/stock/markets/bonds/securities/${encodeURIComponent(security.secid)}.json?iss.meta=off&iss.only=securities,marketdata`;
    const request = getJson(url).then((json) => {
      const securityRows = blockToRows(json.securities);
      const marketRows = blockToRows(json.marketdata);
      const market = marketRows.find((item) => item.LAST || item.BID || item.OFFER || item.LCURRENTPRICE) || marketRows[0] || {};
      const info = securityRows.find((item) => item.BOARDID === market.BOARDID) || securityRows[0] || {};
      return { info, market };
    }).catch((error) => {
      snapshotRequests.delete(security.secid);
      throw error;
    });
    snapshotRequests.set(security.secid, { request, expiresAt: Date.now() + 20000 });
    return request;
  }

  function getCouponInfo(info, alias, security) {
    const issueSize = Number(pick(info, ["ISSUESIZE", "ISSUESIZEPLACED"]));
    const registeredSize = Number(pick(info, ["ISSUESIZE"]));
    const placedValue = pick(info, ["ISSUESIZEPLACED"]);
    const placedSize = placedValue == null || placedValue === "" ? null : Number(placedValue);
    const faceValue = Number(pick(info, ["FACEVALUE", "INITIALFACEVALUE"]));
    const initialFaceValue = Number(pick(info, ["INITIALFACEVALUE", "FACEVALUE"]));
    const couponValue = Number(pick(info, ["COUPONVALUE", "NEXTCOUPONVALUE"]));
    return {
      nextCouponDate: pick(info, ["NEXTCOUPON", "COUPONDATE", "NEXTCOUPONDATE"]),
      nextCouponValue: Number.isFinite(couponValue) ? couponValue : null,
      nextCouponTotal: Number.isFinite(couponValue) && Number.isFinite(placedSize) ? couponValue * placedSize : null,
      maturityDate: pick(info, ["MATDATE", "MATURITYDATE"]),
      optionDate: getEdisclosureOptionDate(alias, security, info),
      couponPercent: pick(info, ["COUPONPERCENT"]),
      issueSize: Number.isFinite(issueSize) ? issueSize : null,
      placedSize: Number.isFinite(placedSize) ? placedSize : null,
      placedPercent: Number.isFinite(registeredSize) && registeredSize > 0 && Number.isFinite(placedSize)
        ? placedSize / registeredSize * 100 : null,
      faceValue: Number.isFinite(faceValue) ? faceValue : null,
      initialFaceValue: Number.isFinite(initialFaceValue) ? initialFaceValue : null,
      couponPeriod: pick(info, ["COUPONPERIOD"]),
      issueAmount: Number.isFinite(issueSize) && Number.isFinite(faceValue) ? issueSize * faceValue : null
    };
  }

  async function loadInitialCouponRate(secid) {
    if (initialCouponRates.has(secid)) return initialCouponRates.get(secid);
    if (!initialCouponCache.has(secid)) {
      const url = `${apiBase}/statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=coupons&start=0&limit=1`;
      const request = getJson(url).then((json) => {
        const first = blockToRows(json.coupons)[0];
        const rate = pick(first, ["valueprc", "VALUEPRC"]);
        if (rate != null) {
          initialCouponRates.set(secid, rate);
          saveData("initial-coupons", Object.fromEntries(initialCouponRates));
          if (lastQuotes.length) renderQuotes(lastQuotes);
        }
        return rate;
      }).catch(() => null);
      initialCouponCache.set(secid, request);
    }
    return initialCouponCache.get(secid);
  }

  async function loadQuote(alias) {
    const security = await resolveAlias(alias);
    if (security.missing) return { ...security, error: "Бумага не найдена в поиске MOEX" };

    const { info, market } = await loadSecuritySnapshot(security);
    loadInitialCouponRate(security.secid);
    const last = pick(market, ["LAST", "LCURRENTPRICE", "MARKETPRICE", "WAPRICE", "LEGALCLOSEPRICE", "PREVPRICE"]);
    const change = pick(market, ["LASTCHANGEPRCNT", "CHANGE"]);
    const yieldValue = pick(market, ["YIELD"]);
    const bid = pick(market, ["BID", "BUYBACKPRICE"]);
    const ask = pick(market, ["OFFER", "SELLBACKPRICE"]);
    const trades = pick(market, ["NUMTRADES", "TRADINGSESSION"]);
    const value = pick(market, ["VALTODAY", "VALUE", "VOLTODAY"]);

    return {
      alias,
      secid: security.secid,
      shortname: pick(info, ["SHORTNAME", "SECNAME"]) || security.shortname,
      board: pick(market, ["BOARDID"]) || security.primaryBoard,
      last,
      change,
      bid,
      ask,
      yieldValue,
      initialCouponRate: floatingCoupons.has(security.secid) ? null : pick(info, ["COUPONPERCENT"]),
      couponType: floatingCoupons.has(security.secid) ? "Флоатер" : "Фикс",
      trades,
      value,
      ...getCouponInfo(info, alias, security)
    };
  }

  async function loadBondReport(alias, reportDateIso, days) {
    const security = await resolveAlias(alias);
    if (security.missing) return { ...security, points: [], error: "Бумага не найдена в поиске MOEX" };

    const infoRequest = loadSecuritySnapshot(security).then(
      (snapshot) => ({ snapshot }), (error) => ({ error })
    );
    const reportDate = parseDate(reportDateIso);
    const fromDate = addDays(reportDate, -Number(days));
    const fromIso = toIsoDate(fromDate);
    const params = `from=${fromIso}&till=${reportDateIso}&iss.meta=off&iss.only=history,history.cursor`;
    const url = `${apiBase}/history/engines/stock/markets/bonds/securities/${encodeURIComponent(security.secid)}.json?${params}`;

    let historyRows = [];
    let lastError = null;
    try {
      historyRows = await getPagedRows(url, "history");
    } catch (error) {
      lastError = error;
    }

    const infoResult = await infoRequest;
    if (infoResult.error) throw infoResult.error;
    const { info } = infoResult.snapshot;
    const toPoints = (rows) => rows.map((item) => ({
        date: pick(item, ["TRADEDATE"]),
        close: Number(pick(item, ["CLOSE", "LEGALCLOSEPRICE", "WAPRICE", "MARKETPRICE2", "PRICE"])),
        ytm: Number(pick(item, ["YIELDCLOSE", "YIELDATWAP", "YIELD", "YIELDTOMATURITY", "EFFECTIVEYIELD"])),
        value: Number(pick(item, ["VALUE", "VOLUME", "NUMTRADES"]))
      }))
      .filter((item) => item.date && Number.isFinite(item.close))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let points = toPoints(historyRows);
    if (!points.length && info.BOARDID) {
      const boardUrl = `${apiBase}/history/engines/stock/markets/bonds/boards/${encodeURIComponent(info.BOARDID)}/securities/${encodeURIComponent(security.secid)}.json?${params}`;
      try {
        points = toPoints(await getPagedRows(boardUrl, "history"));
        if (points.length) lastError = null;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError && !points.length) throw lastError;

    return {
      alias,
      secid: security.secid,
      shortname: pick(info, ["SHORTNAME", "SECNAME"]) || security.shortname,
      board: security.primaryBoard,
      points,
      ...getCouponInfo(info, alias, security),
      error: points.length ? null : (lastError ? lastError.message : "Нет исторических данных за период")
    };
  }

  function findPointOnOrBefore(points, targetIso) {
    let found = null;
    for (const point of points) {
      if (String(point.date).slice(0, 10) <= targetIso) found = point;
      else break;
    }
    return found;
  }

  function getMetricPair(points, reportDateIso) {
    const latest = findPointOnOrBefore(points, reportDateIso);
    const weekAgoIso = latest ? toIsoDate(addDays(latest.date, -7)) : null;
    return {
      yesterdayTarget: reportDateIso,
      weekAgoTarget: weekAgoIso,
      yesterday: latest,
      weekAgo: weekAgoIso ? findPointOnOrBefore(points, weekAgoIso) : null
    };
  }

  function percentChange(current, previous) {
    const now = Number(current);
    const old = Number(previous);
    if (!Number.isFinite(now) || !Number.isFinite(old) || old === 0) return null;
    return ((now - old) / Math.abs(old)) * 100;
  }

  function getEffectiveMaturityDate(item) {
    const maturity = parseDate(item.maturityDate);
    const option = parseDate(item.optionDate);
    if (maturity && option) return maturity < option ? maturity : option;
    return option || maturity;
  }

  function getChartOptions() {
    if (!historyPriceToggle.checked && !historyYieldToggle.checked) {
      historyPriceToggle.checked = true;
    }
    return {
      showPrice: historyPriceToggle.checked,
      showYield: historyYieldToggle.checked
    };
  }

  function matchesIssuer(alias) {
    return issuerFilter === "all" || (alias.startsWith("МКАОВокс") ? issuerFilter === "mkao" : issuerFilter === "ooo");
  }

  function buildReportScale(items, reportDateIso, options) {
    const days = Number(historyPeriodSelect.value);
    const dateTo = parseDate(reportDateIso);
    const dateFrom = addDays(dateTo, -days);

    const closes = options.showPrice ? items.flatMap((item) => item.points || []).map((point) => point.close).filter(Number.isFinite) : [];
    const yields = options.showYield ? items.flatMap((item) => item.points || []).map((point) => point.ytm).filter(Number.isFinite) : [];

    const rawPriceMin = closes.length ? Math.min(...closes, 100) : 99;
    const rawPriceMax = closes.length ? Math.max(...closes, 100) : 101;
    let priceMin = Math.floor(rawPriceMin);
    let priceMax = Math.ceil(rawPriceMax);
    if (priceMin === priceMax) {
      priceMin -= 1;
      priceMax += 1;
    }

    const yieldMin = yields.length ? Math.floor(Math.min(...yields) / 2) * 2 : 0;
    const yieldMax = yields.length ? Math.ceil(Math.max(...yields) / 2) * 2 : 2;
    const normalizedYieldMin = yieldMin === yieldMax ? yieldMin - 1 : yieldMin;
    const normalizedYieldMax = yieldMin === yieldMax ? yieldMax + 1 : yieldMax;

    const priceTicks = [];
    if (options.showPrice) {
      for (let value = priceMax; value >= priceMin; value -= 1) priceTicks.push(value);
    }

    const yieldTicks = [];
    if (options.showYield) {
      for (let value = normalizedYieldMax; value >= normalizedYieldMin; value -= 2) yieldTicks.push(value);
    }

    return {
      ...options,
      dateFrom,
      dateTo,
      priceMin,
      priceMax,
      priceSpan: priceMax - priceMin || 1,
      yieldMin: normalizedYieldMin,
      yieldMax: normalizedYieldMax,
      yieldSpan: normalizedYieldMax - normalizedYieldMin || 1,
      priceTicks,
      yieldTicks,
      monthTicks: getMonthTicks(dateFrom, dateTo)
    };
  }

  function drawReportChart(canvas, points, scale) {
    const axisFont = '500 11px "Source Sans Pro", "Segoe UI", Arial, sans-serif';
    const axisColor = "#6d786f";
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pad = { left: scale.showPrice ? 56 : 18, right: scale.showYield ? 54 : 18, top: 16, bottom: 34 };
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.dataset.axisFont = axisFont;
    canvas.dataset.priceTicks = scale.priceTicks.join(",");
    canvas.dataset.yieldTicks = scale.yieldTicks.join(",");
    canvas.dataset.monthTicks = scale.monthTicks.map(toIsoDate).join(",");
    canvas.dataset.dateFrom = toIsoDate(scale.dateFrom);
    canvas.dataset.dateTo = toIsoDate(scale.dateTo);

    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    if (!points.length) {
      ctx.fillStyle = axisColor;
      ctx.font = axisFont;
      ctx.fillText("Нет исторических данных за выбранный период", 16, height / 2);
      return;
    }

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const yieldTickInterval = Math.max(1, Math.ceil(scale.yieldTicks.length / Math.max(1, Math.floor(plotH / 23))));
    const dateSpan = scale.dateTo.getTime() - scale.dateFrom.getTime() || 1;
    const xForDate = (value) => {
      const date = parseDate(value);
      if (!date) return pad.left;
      return pad.left + ((date.getTime() - scale.dateFrom.getTime()) / dateSpan) * plotW;
    };
    const yForPrice = (value) => pad.top + plotH - ((value - scale.priceMin) / scale.priceSpan) * plotH;
    const yForYield = (value) => pad.top + plotH - ((value - scale.yieldMin) / scale.yieldSpan) * plotH;

    ctx.font = axisFont;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    if (scale.showPrice) {
      for (const value of scale.priceTicks) {
        const y = yForPrice(value);
        const isPar = value === 100;
        ctx.strokeStyle = isPar ? "#173f2c" : "#e3e8df";
        ctx.lineWidth = isPar ? 2 : 1;
        ctx.setLineDash(isPar ? [] : [3, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = axisColor;
        ctx.fillText(formatNumber(value), pad.left - 8, y);
      }
    }

    if (!scale.showPrice && scale.showYield) {
      for (const [index, value] of scale.yieldTicks.entries()) {
        if (index % yieldTickInterval !== 0) continue;
        const y = yForYield(value);
        ctx.strokeStyle = "#e3e8df";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (scale.showYield) {
      ctx.textAlign = "left";
      ctx.fillStyle = axisColor;
      for (const [index, value] of scale.yieldTicks.entries()) {
        if (index % yieldTickInterval !== 0) continue;
        ctx.fillText(formatPercent(value, 0), width - pad.right + 8, yForYield(value));
      }
    }

    ctx.strokeStyle = "#ebeee7";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (const date of scale.monthTicks) {
      const x = xForDate(toIsoDate(date));
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    function drawLine(items, getValue, getY, color, widthValue) {
      const valid = items.filter((point) => Number.isFinite(getValue(point)));
      if (!valid.length) return null;
      ctx.strokeStyle = color;
      ctx.lineWidth = widthValue;
      ctx.setLineDash([]);
      ctx.beginPath();
      valid.forEach((point, index) => {
        const x = xForDate(point.date);
        const y = getY(getValue(point));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const last = valid[valid.length - 1];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xForDate(last.date), getY(getValue(last)), 3.2, 0, Math.PI * 2);
      ctx.fill();
      return {
        x: xForDate(last.date),
        y: getY(getValue(last)),
        value: getValue(last),
        color
      };
    }

    const lastPrice = scale.showPrice ? drawLine(points, (point) => point.close, yForPrice, "#2d7750", 2.5) : null;
    const lastYield = scale.showYield ? drawLine(points, (point) => point.ytm, yForYield, "#ad6950", 2) : null;

    function labelLastPoint(label, point, offsetY) {
      if (!point) return;
      ctx.font = '700 12px "Source Sans Pro", "Segoe UI", Arial, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const x = Math.min(Math.max(point.x - textWidth - 8, pad.left), width - pad.right - textWidth);
      const y = Math.max(pad.top + 2, point.y + offsetY);
      ctx.fillStyle = point.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, x, y);
    }

    labelLastPoint(formatNumber(lastPrice?.value), lastPrice, scale.showYield ? -8 : -10);
    labelLastPoint(formatPercent(lastYield?.value), lastYield, scale.showPrice ? -22 : -10);

    ctx.fillStyle = axisColor;
    ctx.font = axisFont;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const date of scale.monthTicks) {
      ctx.fillText(formatChartMonth(date), xForDate(toIsoDate(date)), height - 22);
    }
  }

  function renderQuotes(quotes) {
    lastQuotes = quotes;
    rows.innerHTML = "";
    const reportDateIso = reportDateInput.value || todayIso();
    const currentReport = reportDateIso === todayIso();
    const visibleQuotes = quotes.filter((quote) => matchesIssuer(quote.alias));
    let outstandingSum = 0;
    let couponSum = 0;
    let weightedCouponSum = 0;
    let hasKnownOutstanding = false;
    let hasKnownCoupons = false;
    let hasAllCouponRates = true;
    const missingQuotes = new Set();

    for (const quote of visibleQuotes) {
      const outstandingAmount = currentReport && quote.placedSize != null && quote.faceValue != null
        ? quote.placedSize * quote.faceValue : null;
      const couponTotal = getCouponTotal(quote, reportDateIso);
      const initialRate = initialCouponRates.get(quote.secid) ?? quote.initialCouponRate;
      const keyRate = floatingCoupons.has(quote.secid) ? getKeyRateOn(reportDateIso) : null;
      const couponRate = floatingCoupons.has(quote.secid)
        ? (keyRate == null ? null : keyRate + 7)
        : (initialRate == null || initialRate === "" ? null : Number(initialRate));
      if (outstandingAmount != null && Number.isFinite(outstandingAmount)) {
        outstandingSum += outstandingAmount;
        hasKnownOutstanding = true;
      } else if (currentReport) missingQuotes.add(quote.alias);
      if (couponTotal != null && Number.isFinite(couponTotal)) {
        couponSum += couponTotal;
        hasKnownCoupons = true;
      } else missingQuotes.add(quote.alias);
      if (outstandingAmount > 0 && Number.isFinite(couponRate)) {
        weightedCouponSum += outstandingAmount * couponRate;
      } else if (outstandingAmount !== 0 && Number.isFinite(outstandingAmount)) {
        hasAllCouponRates = false;
        missingQuotes.add(quote.alias);
      }
      const placedShare = currentReport && quote.placedPercent != null && quote.placedPercent < 99.95
        ? ` <span class="volume-share">(${formatPercent(quote.placedPercent, 1)})</span>` : "";
      const redemption = getEffectiveMaturityDate({
        maturityDate: quote.maturityDate,
        optionDate: parseDate(quote.optionDate) > parseDate(todayIso()) ? quote.optionDate : null
      });
      const redemptionType = redemption && parseDate(quote.optionDate)?.getTime() === redemption.getTime()
        ? "О" : "П";
      const redemptionLabel = redemption ? `${formatDateLong(redemption)} (${redemptionType})` : "-";
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${quote.alias}</td>
        <td>${formatMillionsRub(outstandingAmount)}${placedShare}</td>
        <td>${formatPercent(couponRate)}${couponTerms.has(quote.secid) ? ` <span class="volume-share">(${couponTerms.get(quote.secid)})</span>` : ""}</td>
        <td>${quote.couponType || "-"}</td>
        <td>${formatDateLong(quote.nextCouponDate)}</td>
        <td>${formatRub(couponTotal)}</td>
        <td>${redemptionLabel}</td>
        <td>${formatPercent(quote.yieldValue)}</td>
      `;
      rows.appendChild(row);
    }
    issueTotalRow.hidden = !visibleQuotes.length;
    totalOutstanding.textContent = hasKnownOutstanding ? formatMillionsRub(outstandingSum) : "-";
    totalCouponRate.textContent = currentReport && hasAllCouponRates && outstandingSum > 0
      ? formatPercent(weightedCouponSum / outstandingSum) : "-";
    totalCouponAmount.textContent = hasKnownCoupons ? formatRub(couponSum) : "-";
    issueTotalNote.hidden = !visibleQuotes.length || (currentReport && !missingQuotes.size);
    issueTotalNote.textContent = currentReport
      ? `Неполные данные: ${[...missingQuotes].join(", ")}. Каждый итог рассчитан по доступным значениям MOEX.`
      : "Объём в обращении и средневзвешенная ставка доступны только на текущую дату; сумма купонов — по доступным данным MOEX.";
    window.VoxysCashflow?.update(quotes, reportDateIso, getKeyRateOn(reportDateIso));
  }

  function renderReport(items, reportDateIso) {
    lastReportItems = items;
    historyCharts.innerHTML = "";
    const visibleItems = items.filter((item) => matchesIssuer(item.alias) && (item.points || []).length);
    const sorted = [...visibleItems].sort((a, b) => {
      const aTime = getEffectiveMaturityDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bTime = getEffectiveMaturityDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    const chartOptions = getChartOptions();
    const scale = buildReportScale(sorted, reportDateIso, chartOptions);
    const pendingCharts = [];

    for (const item of sorted) {
      const points = item.points || [];
      const metrics = getMetricPair(points, reportDateIso);
      const priceChange = percentChange(metrics.yesterday?.close, metrics.weekAgo?.close);
      const yieldChange = percentChange(metrics.yesterday?.ytm, metrics.weekAgo?.ytm);
      const priceClass = priceChange == null ? "" : (Number(priceChange) < 0 ? "negative" : "positive");
      const yieldClass = yieldChange == null ? "" : (Number(yieldChange) < 0 ? "negative" : "positive");

      const row = document.createElement("article");
      row.className = "report-row";
      row.innerHTML = `
        <div class="report-chart">
          <div class="card-head">
            <div class="issue-identity">
              <span class="issue-badge" aria-hidden="true"><i data-lucide="${item.alias.startsWith("МКАОВокс") ? "landmark" : "building-2"}"></i></span>
              <div>
                <h3 class="card-title">${item.alias}</h3>
                <div class="chart-legend">
                  ${chartOptions.showPrice ? '<span class="legend-item"><span class="legend-swatch"></span>Курс закрытия</span>' : ""}
                  ${chartOptions.showYield ? '<span class="legend-item"><span class="legend-swatch yield"></span>Доходность к погашению</span>' : ""}
                </div>
              </div>
            </div>
            <span class="secid">${item.secid || "-"}</span>
          </div>
          <canvas aria-label="График курса и доходности ${item.alias}"></canvas>
        </div>
        <aside class="metrics-panel">
          <h4 class="metrics-title">Метрики</h4>
          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label"><i data-lucide="trending-up" aria-hidden="true"></i>Курс на ${formatDateLong(metrics.yesterday?.date)}</span>
              <strong>${formatNumber(metrics.yesterday?.close)} <span class="metric-previous">(${formatNumber(metrics.weekAgo?.close)})</span></strong>
              <em class="metric-change ${priceClass}">${formatSignedPercent(priceChange)} к ${formatDateLong(metrics.weekAgoTarget)}</em>
            </div>
            <div class="metric-card">
              <span class="metric-label"><i data-lucide="percent" aria-hidden="true"></i>Доходность на ${formatDateLong(metrics.yesterday?.date)}</span>
              <strong>${formatPercent(metrics.yesterday?.ytm)} <span class="metric-previous">(${formatPercent(metrics.weekAgo?.ytm)})</span></strong>
              <em class="metric-change ${yieldClass}">${formatSignedPercent(yieldChange)} к ${formatDateLong(metrics.weekAgoTarget)}</em>
            </div>
            <div class="metric-card wide">
              <span class="metric-label"><i data-lucide="calendar-days" aria-hidden="true"></i>Ближайший купон</span>
              <strong>${formatDateLong(item.nextCouponDate)} · ${formatRub(getCouponTotal(item, reportDateIso))}</strong>
            </div>
            <div class="metric-card wide">
              <span class="metric-label"><i data-lucide="wallet" aria-hidden="true"></i>Сумма выпуска</span>
              <strong>${formatMillionsRub(item.issueAmount)}</strong>
            </div>
            <div class="metric-card wide">
              <span class="metric-label"><i data-lucide="pie-chart" aria-hidden="true"></i>Размещено на дату отчета</span>
              <strong>${reportDateIso === todayIso() ? formatPercent(item.placedPercent, 1) : "-"}</strong>
            </div>
            <div class="metric-card wide">
              <span class="metric-label"><i data-lucide="calendar-check" aria-hidden="true"></i>Дата погашения</span>
              <strong>${formatMaturityWithOption(item.maturityDate, item.optionDate)}</strong>
            </div>
          </div>
        </aside>
      `;
      historyCharts.appendChild(row);
      pendingCharts.push({ canvas: row.querySelector("canvas"), points });
    }

    for (const item of pendingCharts) {
      drawReportChart(item.canvas, item.points, scale);
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function setStatus(type, text) {
    statusDot.className = `status-dot ${type}`;
    statusText.textContent = text;
  }

  async function refreshQuotes() {
    if (quoteRequest) return quoteRequest;
    quoteRequest = updateQuotes();
    try {
      return await quoteRequest;
    } finally {
      quoteRequest = null;
    }
  }

  async function updateQuotes() {
    refreshButton.classList.add("loading");
    refreshButton.disabled = true;
    setStatus("", lastQuotes.length
      ? `Показаны данные от ${updatedAt.textContent} · проверяю обновления`
      : "Обновляю данные");
    if (!keyRateRequest && Date.now() - keyRateLoadedAt >= 60 * 60 * 1000) {
      loadKeyRates().then(() => {
        if (lastQuotes.length) renderQuotes(lastQuotes);
        if (lastReportItems.length) renderReport(lastReportItems, reportDateInput.value || todayIso());
      }).catch(() => {});
    }

    try {
      const results = await Promise.allSettled(aliases.map(loadQuote));
      const quotes = results.map((result, index) => (
        result.status === "fulfilled"
          ? result.value
          : lastQuotes.find((quote) => quote.alias === aliases[index])
            || { alias: aliases[index], secid: knownSecids.get(aliases[index]) || aliases[index], error: result.reason.message }
      ));
      renderQuotes(quotes);

      const failures = results.filter((result) => result.status === "rejected").length;
      setStatus(failures ? "bad" : "ok", failures
        ? `MOEX: не обновлено выпусков ${failures} из ${aliases.length}${lastQuotes.some((quote) => !quote.error) ? "; показаны последние доступные данные" : "; сохранённых данных нет"}`
        : "Данные обновлены");
      if (!failures) {
        saveData("quotes", quotes);
        updatedAt.textContent = formatDateTime(Date.now());
      }
    } catch (error) {
      setStatus("bad", error.message || "Не удалось обновить данные");
    } finally {
      refreshButton.classList.remove("loading");
      refreshButton.disabled = false;
    }
  }

  async function refreshReport() {
    const requestId = ++reportRequestId;
    const days = historyPeriodSelect.value;
    const reportDateIso = reportDateInput.value || todayIso();
    const cacheKey = `${reportDateIso}:${days}:${aliases.join("|")}`;
    const saved = readSaved(`report:${cacheKey}`);
    const savedItems = Array.isArray(saved?.data) ? saved.data : null;
    historyStatus.textContent = savedItems
      ? `Сохранённый отчёт от ${formatDateTime(saved.savedAt)} · проверяю обновления`
      : "Загружаю историю";
    renderQuotes(lastQuotes);

    if (reportCache.has(cacheKey)) {
      renderReport(reportCache.get(cacheKey), reportDateIso);
      historyStatus.textContent = `Отчет на ${formatDateLong(reportDateIso)} · период: ${historyPeriodSelect.selectedOptions[0].textContent}`;
      return;
    }

    if (savedItems) renderReport(savedItems, reportDateIso);
    else {
      historyCharts.innerHTML = "";
      lastReportItems = [];
    }

    const results = await Promise.allSettled(aliases.map((alias) => loadBondReport(alias, reportDateIso, days)));
    if (requestId !== reportRequestId) return;
    let failures = 0;
    const items = results.map((result, index) => {
      const savedItem = savedItems?.find((item) => item.alias === aliases[index]);
      if (result.status === "rejected") {
        failures++;
        return savedItem || { alias: aliases[index], secid: knownSecids.get(aliases[index]) || aliases[index], points: [], error: result.reason.message };
      }
      if (!result.value.points.length && savedItem?.points?.length) {
        failures++;
        return savedItem;
      }
      return result.value;
    });
    if (!failures) {
      reportCache.set(cacheKey, items);
      saveData(`report:${cacheKey}`, items);
    }
    renderReport(items, reportDateIso);

    const visibleCount = items.filter((item) => (item.points || []).length).length;
    historyStatus.textContent = failures
      ? `MOEX: не обновлено выпусков ${failures} из ${aliases.length}${savedItems ? "; показаны сохранённые данные" : "; сохранённых данных нет"}`
      : visibleCount
      ? `Отчет на ${formatDateLong(reportDateIso)} · период: ${historyPeriodSelect.selectedOptions[0].textContent}`
      : "Нет данных для выбранного периода";
  }

  function refreshAll() {
    refreshQuotes();
    refreshReport();
  }

  function restartTimer() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(refreshQuotes, Number(intervalSelect.value));
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  }

  reportDateInput.value = todayIso();
  const savedKeyRates = readSaved("key-rates");
  if (Array.isArray(savedKeyRates?.data) && Date.now() - savedKeyRates.savedAt < 60 * 60 * 1000) {
    keyRateDecisions = savedKeyRates.data;
    keyRateLoadedAt = savedKeyRates.savedAt;
  }
  const savedCouponRates = readSaved("initial-coupons")?.data;
  if (savedCouponRates && typeof savedCouponRates === "object") {
    for (const [secid, rate] of Object.entries(savedCouponRates)) initialCouponRates.set(secid, rate);
  }
  const savedQuotes = readSaved("quotes");
  if (Array.isArray(savedQuotes?.data)) {
    renderQuotes(savedQuotes.data);
    setStatus("", `Сохранённые данные от ${formatDateTime(savedQuotes.savedAt)}`);
    updatedAt.textContent = formatDateTime(savedQuotes.savedAt);
  }
  document.querySelectorAll(".issuer-tabs [data-issuer]").forEach((tab) => {
    tab.addEventListener("click", () => {
      issuerFilter = tab.dataset.issuer;
      document.querySelectorAll(".issuer-tabs [data-issuer]").forEach((item) => {
        item.setAttribute("aria-selected", String(item === tab));
      });
      renderQuotes(lastQuotes);
      renderReport(lastReportItems, reportDateInput.value || todayIso());
    });
  });
  if (window.lucide) window.lucide.createIcons();
  refreshButton.addEventListener("click", refreshAll);
  intervalSelect.addEventListener("change", restartTimer);
  historyPeriodSelect.addEventListener("change", refreshReport);
  historyPriceToggle.addEventListener("change", () => {
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  });
  historyYieldToggle.addEventListener("change", () => {
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  });
  reportDateInput.addEventListener("change", () => {
    renderQuotes(lastQuotes);
    refreshReport();
  });
  window.addEventListener("resize", () => {
    renderQuotes(lastQuotes);
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  }, { passive: true });

  restartTimer();
  refreshAll();
})();
