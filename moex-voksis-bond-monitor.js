(function () {
  const aliases = ["МКАОВокс01", "МКАОВокс02", "МКАОВокс03", "Воксис-01", "Воксис-02", "Воксис-03", "Воксис-04"];
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
  let reportCache = new Map();
  const initialCouponCache = new Map();
  let lastQuotes = [];
  let lastReportItems = [];

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
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`MOEX вернул ${response.status}`);
    return response.json();
  }

  async function getPagedRows(url, blockName) {
    const rows = [];
    let start = 0;
    let total = Infinity;
    let pageSize = 100;

    while (rows.length < total) {
      const join = url.includes("?") ? "&" : "?";
      const json = await getJson(`${url}${join}start=${start}`);
      const chunk = blockToRows(json[blockName]);
      rows.push(...chunk);

      const cursor = blockToRows(json[`${blockName}.cursor`])[0];
      if (!cursor) break;

      total = Number(pick(cursor, ["TOTAL"])) || rows.length;
      pageSize = Number(pick(cursor, ["PAGESIZE"])) || chunk.length || pageSize;
      if (!chunk.length) break;
      start += pageSize;
    }

    return rows;
  }

  async function resolveAlias(alias) {
    if (resolved.has(alias)) return resolved.get(alias);

    const url = `${apiBase}/securities.json?q=${encodeURIComponent(alias)}&iss.meta=off`;
    const json = await getJson(url);
    const found = blockToRows(json.securities)
      .filter((item) => String(item.type || "").toLowerCase().includes("bond") || String(item.group || "").toLowerCase().includes("bond") || item.is_traded === 1)
      .find((item) => [item.secid, item.shortname, item.name, item.secname].some((value) => String(value || "").toLowerCase() === alias.toLowerCase()))
      || blockToRows(json.securities)[0];

    if (!found) {
      const fallback = { alias, secid: alias, shortname: alias, missing: true };
      resolved.set(alias, fallback);
      return fallback;
    }

    const result = {
      alias,
      secid: found.secid || alias,
      shortname: found.shortname || found.name || alias,
      primaryBoard: found.primary_boardid || found.boardid || ""
    };
    resolved.set(alias, result);
    return result;
  }

  async function loadSecuritySnapshot(security) {
    const url = `${apiBase}/engines/stock/markets/bonds/securities/${encodeURIComponent(security.secid)}.json?iss.meta=off&iss.only=securities,marketdata`;
    const json = await getJson(url);
    const securityRows = blockToRows(json.securities);
    const marketRows = blockToRows(json.marketdata);
    const market = marketRows.find((item) => item.LAST || item.BID || item.OFFER || item.LCURRENTPRICE) || marketRows[0] || {};
    const info = securityRows.find((item) => item.BOARDID === market.BOARDID) || securityRows[0] || {};
    return { info, market };
  }

  function getCouponInfo(info, alias, security) {
    const issueSize = Number(pick(info, ["ISSUESIZE", "ISSUESIZEPLACED"]));
    const registeredSize = Number(pick(info, ["ISSUESIZE"]));
    const placedValue = pick(info, ["ISSUESIZEPLACED"]);
    const placedSize = placedValue == null || placedValue === "" ? null : Number(placedValue);
    const faceValue = Number(pick(info, ["FACEVALUE", "INITIALFACEVALUE"]));
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
      issueAmount: Number.isFinite(issueSize) && Number.isFinite(faceValue) ? issueSize * faceValue : null
    };
  }

  async function loadInitialCouponRate(secid) {
    if (!initialCouponCache.has(secid)) {
      const url = `${apiBase}/statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=coupons&start=0&limit=1`;
      const request = getJson(url).then((json) => {
        const first = blockToRows(json.coupons)[0];
        return pick(first, ["valueprc", "VALUEPRC"]);
      }).catch(() => null);
      initialCouponCache.set(secid, request);
    }
    return initialCouponCache.get(secid);
  }

  async function loadQuote(alias) {
    const security = await resolveAlias(alias);
    if (security.missing) return { ...security, error: "Бумага не найдена в поиске MOEX" };

    const [{ info, market }, initialCouponRate] = await Promise.all([
      loadSecuritySnapshot(security), loadInitialCouponRate(security.secid)
    ]);
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
      initialCouponRate: initialCouponRate ?? (floatingCoupons.has(security.secid) ? null : pick(info, ["COUPONPERCENT"])),
      couponType: floatingCoupons.has(security.secid) ? "Флоатер" : "Фикс",
      trades,
      value,
      ...getCouponInfo(info, alias, security)
    };
  }

  async function loadBondReport(alias, reportDateIso, days) {
    const security = await resolveAlias(alias);
    if (security.missing) return { ...security, points: [], error: "Бумага не найдена в поиске MOEX" };

    const { info } = await loadSecuritySnapshot(security);
    const reportDate = parseDate(reportDateIso);
    const fromDate = addDays(reportDate, -Number(days));
    const fromIso = toIsoDate(fromDate);
    const params = `from=${fromIso}&till=${reportDateIso}&iss.meta=off`;
    const urls = [];

    if (security.primaryBoard) {
      urls.push(`${apiBase}/history/engines/stock/markets/bonds/boards/${encodeURIComponent(security.primaryBoard)}/securities/${encodeURIComponent(security.secid)}.json?${params}`);
    }
    urls.push(`${apiBase}/history/engines/stock/markets/bonds/securities/${encodeURIComponent(security.secid)}.json?${params}`);

    let historyRows = [];
    let lastError = null;
    for (const url of urls) {
      try {
        historyRows = await getPagedRows(url, "history");
        if (historyRows.length) break;
      } catch (error) {
        lastError = error;
      }
    }

    const points = historyRows
      .map((item) => ({
        date: pick(item, ["TRADEDATE"]),
        close: Number(pick(item, ["CLOSE", "LEGALCLOSEPRICE", "WAPRICE", "MARKETPRICE2", "PRICE"])),
        ytm: Number(pick(item, ["YIELDCLOSE", "YIELDATWAP", "YIELD", "YIELDTOMATURITY", "EFFECTIVEYIELD"])),
        value: Number(pick(item, ["VALUE", "VOLUME", "NUMTRADES"]))
      }))
      .filter((item) => item.date && Number.isFinite(item.close))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

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
    const axisFont = '400 12px "Segoe UI", Arial, sans-serif';
    const axisColor = "#657180";
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
        ctx.strokeStyle = isPar ? "#0d5258" : "#d9e0e8";
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
      for (const value of scale.yieldTicks) {
        const y = yForYield(value);
        ctx.strokeStyle = "#d9e0e8";
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
      for (const value of scale.yieldTicks) {
        ctx.fillText(formatPercent(value, 0), width - pad.right + 8, yForYield(value));
      }
    }

    ctx.strokeStyle = "#edf1f5";
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

    const lastPrice = scale.showPrice ? drawLine(points, (point) => point.close, yForPrice, "#28794b", 2.5) : null;
    const lastYield = scale.showYield ? drawLine(points, (point) => point.ytm, yForYield, "#7a4fb3", 2) : null;

    function labelLastPoint(label, point, offsetY) {
      if (!point) return;
      ctx.font = '700 12px "Segoe UI", Arial, sans-serif';
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

    for (const quote of quotes) {
      const outstandingAmount = quote.placedSize != null && quote.faceValue != null
        ? quote.placedSize * quote.faceValue : null;
      const placedShare = quote.placedPercent != null && quote.placedPercent < 99.95
        ? ` <span class="volume-share">(${formatPercent(quote.placedPercent, 1)})</span>` : "";
      const redemption = getEffectiveMaturityDate({
        maturityDate: quote.maturityDate,
        optionDate: parseDate(quote.optionDate) > parseDate(todayIso()) ? quote.optionDate : null
      });
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${quote.shortname || quote.alias}</td>
        <td>${formatMillionsRub(outstandingAmount)}${placedShare}</td>
        <td>${couponTerms.get(quote.secid) || formatPercent(quote.initialCouponRate)}</td>
        <td>${quote.couponType || "-"}</td>
        <td>${formatDateLong(quote.nextCouponDate)}</td>
        <td>${formatRub(quote.nextCouponTotal)}</td>
        <td>${formatDateLong(redemption)}</td>
        <td>${formatPercent(quote.yieldValue)}</td>
      `;
      rows.appendChild(row);
    }
  }

  function renderReport(items, reportDateIso) {
    lastReportItems = items;
    historyCharts.innerHTML = "";
    const visibleItems = items.filter((item) => (item.points || []).length);
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
            <div>
              <h3 class="card-title">${item.alias}</h3>
              <div class="chart-legend">
                ${chartOptions.showPrice ? '<span class="legend-item"><span class="legend-swatch"></span>Курс закрытия</span>' : ""}
                ${chartOptions.showYield ? '<span class="legend-item"><span class="legend-swatch yield"></span>Доходность к погашению</span>' : ""}
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
              <span>Курс на ${formatDateLong(metrics.yesterday?.date)}</span>
              <strong>${formatNumber(metrics.yesterday?.close)} <span class="metric-previous">(${formatNumber(metrics.weekAgo?.close)})</span></strong>
              <em class="metric-change ${priceClass}">${formatSignedPercent(priceChange)} к ${formatDateLong(metrics.weekAgoTarget)}</em>
            </div>
            <div class="metric-card">
              <span>Доходность на ${formatDateLong(metrics.yesterday?.date)}</span>
              <strong>${formatPercent(metrics.yesterday?.ytm)} <span class="metric-previous">(${formatPercent(metrics.weekAgo?.ytm)})</span></strong>
              <em class="metric-change ${yieldClass}">${formatSignedPercent(yieldChange)} к ${formatDateLong(metrics.weekAgoTarget)}</em>
            </div>
            <div class="metric-card wide">
              <span>Ближайший купон</span>
              <strong>${formatDateLong(item.nextCouponDate)} · ${formatRub(item.nextCouponTotal)}</strong>
            </div>
            <div class="metric-card wide">
              <span>Сумма выпуска</span>
              <strong>${formatMillionsRub(item.issueAmount)}</strong>
            </div>
            <div class="metric-card wide">
              <span>Размещено на дату отчета</span>
              <strong>${reportDateIso === todayIso() ? formatPercent(item.placedPercent, 1) : "-"}</strong>
            </div>
            <div class="metric-card wide">
              <span>Дата погашения</span>
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
  }

  function setStatus(type, text) {
    statusDot.className = `status-dot ${type}`;
    statusText.textContent = text;
  }

  async function refreshQuotes() {
    refreshButton.classList.add("loading");
    refreshButton.disabled = true;
    setStatus("", "Обновляю данные");

    try {
      const results = await Promise.allSettled(aliases.map(loadQuote));
      const quotes = results.map((result, index) => (
        result.status === "fulfilled"
          ? result.value
          : { alias: aliases[index], secid: aliases[index], error: result.reason.message }
      ));
      renderQuotes(quotes);

      const failures = quotes.filter((quote) => quote.error);
      setStatus(failures.length ? "bad" : "ok", failures.length ? failures.map((quote) => `${quote.alias}: ${quote.error}`).join("; ") : "Данные обновлены");
      updatedAt.textContent = new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(new Date());
    } catch (error) {
      setStatus("bad", error.message || "Не удалось обновить данные");
    } finally {
      refreshButton.classList.remove("loading");
      refreshButton.disabled = false;
    }
  }

  async function refreshReport() {
    const days = historyPeriodSelect.value;
    const reportDateIso = reportDateInput.value || todayIso();
    const cacheKey = `${reportDateIso}:${days}:${aliases.join("|")}`;
    historyStatus.textContent = "Загружаю историю";

    if (reportCache.has(cacheKey)) {
      renderReport(reportCache.get(cacheKey), reportDateIso);
      historyStatus.textContent = `Отчет на ${formatDateLong(reportDateIso)} · период: ${historyPeriodSelect.selectedOptions[0].textContent}`;
      return;
    }

    const results = await Promise.allSettled(aliases.map((alias) => loadBondReport(alias, reportDateIso, days)));
    const items = results.map((result, index) => (
      result.status === "fulfilled"
        ? result.value
        : { alias: aliases[index], secid: aliases[index], points: [], error: result.reason.message }
    ));

    reportCache.set(cacheKey, items);
    renderReport(items, reportDateIso);

    const visibleCount = items.filter((item) => (item.points || []).length).length;
    historyStatus.textContent = visibleCount
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

  reportDateInput.value = todayIso();
  refreshButton.addEventListener("click", refreshAll);
  intervalSelect.addEventListener("change", restartTimer);
  historyPeriodSelect.addEventListener("change", refreshReport);
  historyPriceToggle.addEventListener("change", () => {
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  });
  historyYieldToggle.addEventListener("change", () => {
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  });
  reportDateInput.addEventListener("change", refreshReport);
  window.addEventListener("resize", () => {
    renderQuotes(lastQuotes);
    renderReport(lastReportItems, reportDateInput.value || todayIso());
  }, { passive: true });

  restartTimer();
  refreshAll();
})();
