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
      date: "2026-12-15",
      source: "https://fs.moex.com/f/21240/uvedomlenie-25.pdf"
    },
    {
      aliases: ["Воксис-03", "RU000A10BW39"],
      date: "2026-12-19",
      source: "https://fs.moex.com/f/22333/uvedomlenie-27.pdf"
    },
    {
      aliases: ["Воксис-03", "RU000A10BW39"],
      date: "2027-12-14",
      source: "https://fs.moex.com/f/22333/uvedomlenie-27.pdf"
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
  const issueTerms = new Map();
  const issueTermRequests = new Map();
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

  function readReportHistory(cacheKey, reportDateIso, days) {
    const exact = readSaved(`report:${cacheKey}`);
    if (Array.isArray(exact?.data) && exact.data.some((item) => item.points?.length)) return exact;
    const from = toIsoDate(addDays(reportDateIso, -Number(days)));
    const prefix = "voxys-monitor:report:";
    let best = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const candidate = readSaved(key.slice("voxys-monitor:".length));
        if (!Array.isArray(candidate?.data) || (best && candidate.savedAt <= best.savedAt)) continue;
        const data = candidate.data.filter((item) => aliases.includes(item.alias)).map((item) => ({
          ...item,
          points: (item.points || []).filter((point) => point.date >= from && point.date <= reportDateIso)
        }));
        if (data.some((item) => item.points.length)) best = { ...candidate, data };
      }
    } catch (_) {
      // Storage can be disabled.
    }
    return best;
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
      item.date > todayIso() && item.aliases.some((value) => keys.includes(normalizeKey(value)))
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
      issueDate: pick(info, ["ISSUEDATE"]),
      emissionAmount: registeredSize > 0 && Number(pick(info, ["INITIALFACEVALUE"])) > 0
        ? registeredSize * Number(pick(info, ["INITIALFACEVALUE"])) : null,
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

    const { info, market } = await loadSecuritySnapshot(security).finally(() => loadIssueTerms(security.secid));
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

  function loadIssueTerms(secid) {
    if (issueTermRequests.has(secid)) return;
    const saved = readSaved(`issue-terms:${secid}`);
    if (saved?.data) issueTerms.set(secid, saved.data);
    if (saved?.data?.maturityDate && saved?.savedAt && Date.now() - saved.savedAt < 86400000) return;
    const request = getJson(`${apiBase}/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=description`).then((json) => {
      const info = Object.fromEntries(blockToRows(json.description).map((row) => [String(row.name).toUpperCase(), row.value]));
      const count = Number(pick(info, ["ISSUESIZE"]));
      const face = Number(pick(info, ["INITIALFACEVALUE"]));
      const data = {
        maturityDate: pick(info, ["MATDATE"]),
        issueDate: pick(info, ["ISSUEDATE"]),
        emissionAmount: count > 0 && face > 0 ? count * face : null
      };
      issueTerms.set(secid, data);
      saveData(`issue-terms:${secid}`, data);
      if (lastQuotes.length) renderQuotes(lastQuotes);
    }).catch(() => {});
    issueTermRequests.set(secid, request);
  }

  async function loadBondReport(alias, reportDateIso, days) {
    const security = await resolveAlias(alias);
    if (security.missing) return { ...security, points: [], error: "Бумага не найдена в поиске MOEX" };

    let snapshot;
    const infoRequest = loadSecuritySnapshot(security).then((value) => { snapshot = value; }, () => {});
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

    const placementBoards = new Set(["PSAU"]);
    const toPoints = (rows) => rows.map((item) => {
      const boardId = String(pick(item, ["BOARDID"]) || "").toUpperCase();
      const turnoverRub = pick(item, ["VALUE"]) == null ? null : Number(item.VALUE);
      return ({
        date: pick(item, ["TRADEDATE"]),
        close: Number(pick(item, ["CLOSE", "LEGALCLOSEPRICE", "WAPRICE", "MARKETPRICE2", "PRICE"]) ?? NaN),
        ytm: Number(pick(item, ["YIELDCLOSE", "YIELDATWAP", "YIELD", "YIELDTOMATURITY", "EFFECTIVEYIELD"]) ?? NaN),
        turnoverRub,
        primaryTurnoverRub: placementBoards.has(boardId) && Number.isFinite(turnoverRub) ? turnoverRub : 0,
        value: Number(pick(item, ["VALUE", "VOLUME", "NUMTRADES"]))
      });
    })
      .filter((item) => item.date && (Number.isFinite(item.close) || Number.isFinite(item.turnoverRub)))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let points = toPoints(historyRows);
    await infoRequest;
    const hasPrimaryHistory = historyRows.some((item) => placementBoards.has(String(pick(item, ["BOARDID"]) || "").toUpperCase()));
    const issueDate = String(pick(snapshot?.info, ["ISSUEDATE"]) || "").slice(0, 10);
    const placementByDate = new Map();
    if (!hasPrimaryHistory && issueDate && issueDate >= fromIso && issueDate <= reportDateIso) {
      const placementBoards = ["PSAU"];
      const placementPages = await Promise.all(placementBoards.map(async (placementBoard) => {
        const placementUrl = `${apiBase}/history/engines/stock/markets/bonds/boards/${placementBoard}/securities/${encodeURIComponent(security.secid)}.json?${params}`;
        try {
          return await getPagedRows(placementUrl, "history");
        } catch (_) {
          return [];
        }
      }));
      for (const placementRows of placementPages) {
        for (const item of placementRows) {
          const date = pick(item, ["TRADEDATE"]);
          const amount = Number(pick(item, ["VALUE"]));
          if (date && Number.isFinite(amount) && amount > 0) placementByDate.set(date, (placementByDate.get(date) || 0) + amount);
        }
      }
    }
    const savedQuote = lastQuotes.find((item) => item.alias === alias && !item.error);
    const board = snapshot?.info.BOARDID || savedQuote?.board || security.primaryBoard;
    if (!points.some((item) => Number.isFinite(item.close)) && board) {
      const boardUrl = `${apiBase}/history/engines/stock/markets/bonds/boards/${encodeURIComponent(board)}/securities/${encodeURIComponent(security.secid)}.json?${params}`;
      try {
        points = toPoints(await getPagedRows(boardUrl, "history"));
        if (points.length) lastError = null;
      } catch (error) {
        lastError = error;
      }
    }
    for (const [date, amount] of placementByDate) {
      const point = points.find((item) => item.date === date);
      if (point) {
        point.turnoverRub = (Number.isFinite(point.turnoverRub) ? point.turnoverRub : 0) + amount;
        point.primaryTurnoverRub = (point.primaryTurnoverRub || 0) + amount;
      } else {
        points.push({ date, close: NaN, ytm: NaN, turnoverRub: amount, primaryTurnoverRub: amount, value: NaN });
      }
    }
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (lastError && !points.length) throw lastError;

    const info = snapshot?.info;
    return {
      ...(info ? getCouponInfo(info, alias, security) : savedQuote || {}),
      alias,
      secid: security.secid,
      shortname: pick(info, ["SHORTNAME", "SECNAME"]) || security.shortname,
      board,
      points,
      optionDate: getEdisclosureOptionDate(alias, security, info || {}),
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

  function drawVolumeChart(canvas, points, scale) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const left = scale.showPrice ? 56 : 18;
    const right = scale.showYield ? 54 : 18;
    const plotW = Math.max(1, width - left - right);
    const plotH = height - 40;
    const span = scale.dateTo - scale.dateFrom || 1;
    const valid = points.filter((p) => Number.isFinite(p.turnoverRub) && p.turnoverRub >= 0);
    ctx.font = '500 11px "Source Sans Pro", "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = "#6d786f";
    if (!valid.length) {
      ctx.fillText("Нет данных об объёмах торгов", left, 35);
      return;
    }
    const max = Math.max(...valid.map((p) => p.turnoverRub), 1);
    const x = (date) => left + (parseDate(date) - scale.dateFrom) / span * plotW;
    ctx.textAlign = "left";
    for (let i = 0; i <= 2; i++) {
      const y = 12 + plotH * (1 - i / 2);
      ctx.strokeStyle = "#e3e8df";
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      ctx.fillStyle = "#6d786f";
      ctx.fillText(formatNumber(max * i / 2 / 1000000), left, y - 3);
    }
    const barWidth = Math.max(1, Math.min(12, plotW * 86400000 / span * 0.75));
    ctx.save();
    ctx.beginPath(); ctx.rect(left, 12, plotW, plotH); ctx.clip();
    ctx.fillStyle = "#5d8979";
    for (const point of valid) {
      const barHeight = point.turnoverRub / max * plotH;
      ctx.fillRect(x(point.date) - barWidth / 2, 12 + plotH - barHeight, barWidth, barHeight);
    }
    ctx.restore();
    ctx.fillStyle = "#6d786f";
    for (const date of scale.monthTicks) {
      const label = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
      ctx.fillText(label, Math.min(x(date), width - right - 32), height - 4);
    }
    canvas.removeAttribute?.("title");
    const tooltip = document.createElement("div");
    tooltip.className = "volume-tooltip";
    tooltip.hidden = true;
    canvas.parentElement?.appendChild(tooltip);
    canvas.onmousemove = (event) => {
      const bounds = canvas.getBoundingClientRect();
      const mouseX = (event.clientX - bounds.left) * width / bounds.width;
      const mouseY = (event.clientY - bounds.top) * height / bounds.height;
      const point = valid.find((p) => {
        const barHeight = p.turnoverRub / max * plotH;
        return p.turnoverRub > 0 && Math.abs(mouseX - x(p.date)) <= barWidth / 2
          && mouseY >= 12 + plotH - barHeight && mouseY <= 12 + plotH;
      });
      tooltip.hidden = !point;
      if (!point) return;
      tooltip.textContent = `${formatDateLong(point.date)} · ${formatRub(point.turnoverRub)}`;
      const parent = canvas.parentElement.getBoundingClientRect();
      tooltip.style.left = `${Math.max(0, Math.min(event.clientX - parent.left + 10, parent.width - tooltip.offsetWidth))}px`;
      tooltip.style.top = `${Math.max(0, event.clientY - parent.top - tooltip.offsetHeight - 10)}px`;
    };
    canvas.onmouseleave = () => { tooltip.hidden = true; };
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
        date: last.date,
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

    const lastLabels = [
      lastPrice ? { point: lastPrice, label: formatNumber(lastPrice.value) } : null,
      lastYield ? { point: lastYield, label: formatPercent(lastYield.value) } : null
    ].filter(Boolean);
    if (lastLabels.length === 2 && lastLabels[0].point.date === lastLabels[1].point.date) {
      lastLabels.sort((a, b) => a.point.y - b.point.y);
      labelLastPoint(lastLabels[0].label, lastLabels[0].point, -8);
      labelLastPoint(lastLabels[1].label, lastLabels[1].point, 18);
    } else {
      lastLabels.forEach((item, index) => labelLastPoint(item.label, item.point, -10 - index * 14));
    }

    ctx.fillStyle = axisColor;
    ctx.font = axisFont;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const date of scale.monthTicks) {
      ctx.fillText(formatChartMonth(date), xForDate(toIsoDate(date)), height - 22);
    }
    const tooltip = document.createElement("div");
    tooltip.className = "volume-tooltip";
    tooltip.hidden = true;
    canvas.parentElement?.appendChild(tooltip);
    canvas.onmousemove = (event) => {
      const bounds = canvas.getBoundingClientRect();
      const mx = (event.clientX - bounds.left) * width / bounds.width;
      const my = (event.clientY - bounds.top) * height / bounds.height;
      tooltip.hidden = true;
      if (mx < pad.left || mx > width - pad.right || my < pad.top || my > height - pad.bottom) return;
      let nearest = null;
      for (const point of points) {
        const candidates = [
          scale.showPrice && Number.isFinite(point.close) ? { value: formatNumber(point.close), name: "Курс", y: yForPrice(point.close), color: "#2d7750" } : null,
          scale.showYield && Number.isFinite(point.ytm) ? { value: formatPercent(point.ytm), name: "Доходность", y: yForYield(point.ytm), color: "#ad6950" } : null
        ].filter(Boolean);
        for (const candidate of candidates) {
          const distance = Math.hypot(mx - xForDate(point.date), my - candidate.y);
          if (!nearest || distance < nearest.distance) nearest = { ...candidate, date: point.date, distance };
        }
      }
      if (!nearest || nearest.distance > 24) return;
      tooltip.hidden = false;
      tooltip.textContent = `${formatDateLong(nearest.date)} · ${nearest.name}: ${nearest.value}`;
      tooltip.style.background = nearest.color;
      const parent = canvas.parentElement.getBoundingClientRect();
      tooltip.style.left = `${Math.max(0, Math.min(event.clientX - parent.left + 10, parent.width - tooltip.offsetWidth))}px`;
      tooltip.style.top = `${Math.max(0, event.clientY - parent.top - tooltip.offsetHeight - 10)}px`;
    };
    canvas.onmouseleave = () => { tooltip.hidden = true; };
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
    const redemptionCells = new Map();

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
      const redemptionLabel = "-";
      const row = document.createElement("tr");
      const terms = issueTerms.get(quote.secid);
      row.innerHTML = `
        <td>${quote.alias}</td>
        <td>${formatDateLong(terms?.issueDate || quote.issueDate)}</td>
        <td>${formatMillionsRub(terms?.emissionAmount ?? quote.emissionAmount)}</td>
        <td>${formatMillionsRub(outstandingAmount)}${placedShare}</td>
        <td>${formatPercent(couponRate)}${couponTerms.has(quote.secid) ? ` <span class="volume-share">(${couponTerms.get(quote.secid)})</span>` : ""}</td>
        <td>${quote.couponType || "-"}</td>
        <td>${formatDateLong(quote.nextCouponDate)}</td>
        <td>${formatRub(couponTotal)}</td>
        <td>${redemptionLabel}</td>
        <td>${formatPercent(quote.yieldValue)}</td>
      `;
      rows.appendChild(row);
      redemptionCells.set(quote.alias, row);
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
    updateCombinedYields(lastReportItems, reportDateIso);
    window.VoxysCashflow?.update(quotes, reportDateIso, getKeyRateOn(reportDateIso), (redemptions) => {
      for (const [alias, row] of redemptionCells) {
        const cell = row.children[8];
        const redemption = redemptions[alias];
        if (cell) cell.textContent = redemption ? `${formatDateLong(redemption.date)} (${redemption.type})` : "-";
      }
    });
  }

  function updateCombinedYields(items, reportDateIso) {
    const enriched = items.map((item) => ({
      ...item,
      maturityDate: issueTerms.get(item.secid)?.maturityDate || item.maturityDate
        || lastQuotes.find((quote) => quote.alias === item.alias)?.maturityDate,
      redeemed: item.alias === "Воксис-02"
    }));
    window.VoxysYields?.update(enriched, toIsoDate(addDays(reportDateIso, -Number(historyPeriodSelect.value))), reportDateIso);
  }

  function renderReport(items, reportDateIso) {
    updateCombinedYields(items, reportDateIso);
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
          <div class="volume-heading">Объём торгов за день, млн ₽</div>
          <canvas class="volume-chart" aria-label="Дневной объём торгов ${item.alias}"></canvas>
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
      pendingCharts.push({ canvas: row.querySelector("canvas"), volumeCanvas: row.querySelector(".volume-chart"), points });
    }

    for (const item of pendingCharts) {
      drawReportChart(item.canvas, item.points, scale);
      if (item.volumeCanvas) drawVolumeChart(item.volumeCanvas, item.points, scale);
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
    const saved = readReportHistory(cacheKey, reportDateIso, days);
    const savedItems = Array.isArray(saved?.data) ? saved.data.map((item) => ({
      ...item,
      optionDate: getEdisclosureOptionDate(item.alias, { secid: item.secid }, {})
    })) : null;
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
      window.VoxysYields?.update([], toIsoDate(addDays(reportDateIso, -Number(days))), reportDateIso);
    }

    let failures = 0;
    let usedSaved = false;
    const items = aliases.map((alias) => savedItems?.find((item) => item.alias === alias));
    await Promise.all(aliases.map(async (alias, index) => {
      try {
        items[index] = await loadBondReport(alias, reportDateIso, days);
      } catch (_) {
        items[index] = savedItems?.find((item) => item.alias === alias);
        usedSaved ||= Boolean(items[index]?.points?.length);
        failures++;
      }
      if (requestId === reportRequestId) renderReport(items.filter(Boolean), reportDateIso);
    }));
    if (requestId !== reportRequestId) return;
    if (!failures) {
      reportCache.set(cacheKey, items);
      saveData(`report:${cacheKey}`, items);
    }
    const visibleCount = items.filter((item) => item?.points?.length).length;
    historyStatus.textContent = failures
      ? `MOEX: не обновлено выпусков ${failures} из ${aliases.length}${usedSaved ? "; показаны сохранённые данные" : ""}`
      : visibleCount
      ? `Отчет на ${formatDateLong(reportDateIso)} · период: ${historyPeriodSelect.selectedOptions[0].textContent}`
      : "Нет данных для выбранного периода";
  }

  function refreshAll() {
    refreshReport();
    refreshQuotes();
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
