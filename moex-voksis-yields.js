(function (root) {
  const colors = { "МКАОВокс01": "#276b51", "МКАОВокс02": "#d1a029", "МКАОВокс03": "#8b626e", "Воксис-01": "#468b9b", "Воксис-02": "#8b9a52", "Воксис-03": "#cc7054", "Воксис-04": "#6579a4" };
  const hidden = new Set();
  const manuallySelected = new Set();
  let state;
  function weeklyComparison(items, to, field) {
    const records = items.map((item) => {
      const points = (item.points || []).filter((point) => point.date <= to && Number.isFinite(point[field]))
        .sort((a, b) => a.date.localeCompare(b.date));
      const current = points[points.length - 1];
      if (!current) return null;
      const targetDate = new Date(Date.parse(`${current.date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
      const weekAgo = [...points].reverse().find((point) => point.date <= targetDate);
      return { item, current, weekAgo, weight: Number(item.volumeWeight) };
    }).filter(Boolean);
    const weightedAverage = (entries, getPoint) => {
      const weighted = entries.filter((entry) => getPoint(entry) && Number.isFinite(entry.weight) && entry.weight > 0);
      const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      if (!totalWeight) return null;
      const value = weighted.reduce((sum, entry) => sum + getPoint(entry)[field] * entry.weight, 0) / totalWeight;
      const time = weighted.reduce((sum, entry) => sum + Date.parse(`${getPoint(entry).date}T00:00:00Z`) * entry.weight, 0) / totalWeight;
      return { value, date: new Date(time).toISOString().slice(0, 10) };
    };
    const weekly = records.filter((entry) => entry.weekAgo);
    return {
      current: weightedAverage(records, (entry) => entry.current),
      weekAgo: weightedAverage(weekly, (entry) => entry.weekAgo),
      weekValues: weekly.map((entry) => ({ item: entry.item, point: entry.weekAgo, value: entry.weekAgo[field] }))
    };
  }
  function renderLineChart(items, from, to, price = false) {
    const field = price ? "close" : "ytm";
    const series = items.map((item) => ({ ...item, points: (item.points || []).filter((p) => p.date >= from && p.date <= to && Number.isFinite(p[field])) }));
    const values = series.flatMap((item) => item.points.map((p) => p[field]));
    if (!values.length) return '<p class="cashflow-empty">Нет данных для выбранных выпусков.</p>';
    const step = price ? 1 : 2;
    const min = Math.floor(Math.min(...values, ...(price ? [100] : [])) / step) * step;
    const max = Math.max(min + step, Math.ceil(Math.max(...values, ...(price ? [100] : [])) / step) * step);
    const width = 1000, height = 154, left = 56, right = 22, top = 12, bottom = 20;
    const timestamp = (date) => Date.parse(date + "T00:00:00Z");
    const start = timestamp(from), span = Math.max(1, timestamp(to) - start);
    const x = (date) => left + (timestamp(date) - start) / span * (width - left - right);
    const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
    const ticks = [];
    for (let v = min; v <= max; v += step) ticks.push(`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="${price && v === 100 ? "#173f2c" : "#e3e8df"}" stroke-width="${price && v === 100 ? 2 : 1}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${price ? v.toFixed(2).replace(".", ",") : v + "%"}</text>`);
    const cursor = new Date(timestamp(from));
    cursor.setUTCDate(1);
    while (cursor.getTime() <= timestamp(to)) {
      const date = cursor.toISOString().slice(0, 10);
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (cursor.getTime() >= start) ticks.push(`<line class="yield-month-divider" x1="${x(date)}" x2="${x(date)}" y1="${top}" y2="${height-bottom}" stroke="#d4ddd7" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const lines = series.map((item) => {
      const color = colors[item.alias] || "#777";
      const path = item.points.map((p, i) => `${i ? "L" : "M"}${x(p.date)} ${y(p[field])}`).join(" ");
      const points = item.points.map((p) => `<circle cx="${x(p.date)}" cy="${y(p[field])}" r="6" fill="transparent" stroke="transparent"><title>${item.alias} · ${p.date.split("-").reverse().join(".")} · ${p[field].toFixed(2).replace(".", ",")}${price ? "" : "%"}</title></circle>`).join("");
      return `<g style="--line-color:${color}"><path class="issue-series-line" d="${path}" fill="none" stroke="${color}" stroke-width="4" stroke-opacity="0.58" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>${points}</g>`;
    }).join("");
    const endpoints = series.map((item) => {
      const point = item.points[item.points.length - 1];
      return point ? { item, point, value: point[field], color: colors[item.alias] || "#777" } : null;
    }).filter(Boolean);
    const labels = [];
    const overlays = [];
    const comparison = weeklyComparison(items, to, field);
    if (comparison.weekAgo && comparison.current && comparison.weekAgo.date >= from) {
      const low = comparison.weekValues.reduce((best, current) => current.value < best.value ? current : best);
      const high = comparison.weekValues.reduce((best, current) => current.value > best.value ? current : best);
      const rangeX = x(comparison.weekAgo.date);
      const rangeTop = y(high.value), rangeBottom = y(low.value);
      const arrowStartX = x(comparison.weekAgo.date), arrowStartY = y(comparison.weekAgo.value);
      const arrowEndX = x(comparison.current.date), arrowEndY = y(comparison.current.value);
      const markerId = price ? "weekly-average-arrow-price" : "weekly-average-arrow-yield";
      const arrowColor = comparison.current.value > comparison.weekAgo.value ? "#27804d"
        : comparison.current.value < comparison.weekAgo.value ? "#b33948" : "#75857c";
      const formatValue = (value) => `${value.toFixed(1).replace(".", ",")}${price ? "" : "%"}`;
      const range = (className, px, highValue, lowValue) => {
        const highY = y(highValue), lowY = y(lowValue);
        return `<g class="${className}" stroke="#75857c"><line x1="${px}" x2="${px}" y1="${highY}" y2="${lowY}" stroke-width="1.5" stroke-dasharray="3 3"/><line x1="${px-4}" x2="${px+4}" y1="${highY}" y2="${highY}"/><line x1="${px-4}" x2="${px+4}" y1="${lowY}" y2="${lowY}"/></g>`;
      };
      overlays.push(`<defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill="${arrowColor}"/></marker></defs>`);
      overlays.push(range("comparison-range-week", rangeX, high.value, low.value));
      if (endpoints.length) {
        const currentHigh = Math.max(...endpoints.map((entry) => entry.value));
        const currentLow = Math.min(...endpoints.map((entry) => entry.value));
        overlays.push(range("comparison-range-current", arrowEndX, currentHigh, currentLow));
      }
      const highLabelY = Math.max(top+9,rangeTop-3);
      const lowLabelY = Math.min(height-bottom-1,rangeBottom+10);
      overlays.push(`<text class="weekly-range-label" x="${rangeX+6}" y="${highLabelY}" fill="${colors[high.item.alias] || "#777"}" text-anchor="start">${formatValue(high.value)}</text>${low.item.alias !== high.item.alias ? `<text class="weekly-range-label" x="${rangeX+6}" y="${lowLabelY}" fill="${colors[low.item.alias] || "#777"}" text-anchor="start">${formatValue(low.value)}</text>` : ""}`);
      overlays.push(`<line class="weekly-average-arrow" x1="${arrowStartX}" y1="${arrowStartY}" x2="${arrowEndX}" y2="${arrowEndY}" stroke="${arrowColor}" stroke-width="1.8" marker-end="url(#${markerId})"><title>Средневзвешенное значение: ${formatValue(comparison.weekAgo.value)} → ${formatValue(comparison.current.value)}</title></line><circle cx="${arrowStartX}" cy="${arrowStartY}" r="3.5" fill="white" stroke="${arrowColor}" stroke-width="1.5"/><circle cx="${arrowEndX}" cy="${arrowEndY}" r="3.5" fill="${arrowColor}"/>`);
    }
    if (endpoints.length) {
      const highest = endpoints.reduce((best, current) => current.value > best.value ? current : best);
      const lowest = endpoints.reduce((best, current) => current.value < best.value ? current : best);
      const formatValue = (value) => `${value.toFixed(1).replace(".", ",")}${price ? "" : "%"}`;
      const addLabel = (entry, extreme) => {
        const px = x(entry.point.date), py = y(entry.value);
        const anchor = px > width - right - 76 ? "end" : px < left + 76 ? "start" : "middle";
        const labelX = anchor === "end" ? px - 6 : anchor === "start" ? px + 6 : px;
        const labelY = extreme === "max" ? Math.max(top + 10, py - 8) : Math.min(height - bottom - 2, py + 15);
        labels.push(`<circle cx="${px}" cy="${py}" r="3.5" fill="${entry.color}"/><text class="combined-endpoint-label" data-series="${entry.item.alias}" data-extreme="${extreme}" x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${entry.color}">${formatValue(entry.value)}</text>`);
      };
      addLabel(highest, "max");
      if (lowest.item.alias !== highest.item.alias) addLabel(lowest, "min");
    }
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${price ? "Курсы" : "Доходности"} всех выбранных выпусков" class="combined-yields-svg">${ticks.join("")}${lines}${overlays.join("")}${labels.join("")}</svg>`;
  }
  function renderChart(items, from, to) { return renderLineChart(items, from, to); }
  function renderPrice(items, from, to) { return renderLineChart(items, from, to, true); }
  function dailyVolumes(items, from, to) {
    const days = new Map();
    for (const item of items) {
      for (const point of item.points || []) {
        if (point.date < from || point.date > to || !Number.isFinite(point.turnoverRub) || point.turnoverRub < 0) continue;
        const totals = days.get(point.date) || { total: 0, primary: 0 };
        totals.total += point.turnoverRub;
        totals.primary += Number.isFinite(point.primaryTurnoverRub) ? point.primaryTurnoverRub : 0;
        days.set(point.date, totals);
      }
    }
    return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, totals]) => [date, totals.total, Math.min(totals.total, totals.primary)]);
  }

  function renderVolume(items, from, to) {
    const days = dailyVolumes(items, from, to);
    const heading = '<h3 class="combined-chart-title">Суммарный объём торгов за день, млн ₽</h3><p class="volume-heading"><span style="color:#5d8979">■</span> Вторичные торги &nbsp; <span style="color:#d1a029">■</span> Первичное размещение</p>';
    if (!days.length) return heading + '<p class="cashflow-empty">Нет данных об объёмах выбранных выпусков.</p>';
    const start = Date.parse(from + "T00:00:00Z"), end = Date.parse(to + "T00:00:00Z");
    const span = Math.max(1, end - start);
    const width = 1000, height = 106, left = 56, right = 22, top = 9, bottom = 30;
    const plotH = height - top - bottom;
    const max = Math.max(1, ...days.map(([, amount]) => amount));
    const x = (time) => left + (time - start) / span * (width - left - right);
    const rawStep = max / 2;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = Math.max(magnitude, Math.ceil(rawStep / magnitude) * magnitude);
    const axisMax = Math.ceil(max / step) * step;
    const y = (amount) => top + plotH * (1 - amount / axisMax);
    const fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
    let grid = "";
    for (let amount = 0; amount <= axisMax; amount += step) {
      grid += `<line x1="${left}" x2="${width-right}" y1="${y(amount)}" y2="${y(amount)}" stroke="#e3e8df"/><text x="${left-8}" y="${y(amount)+4}" text-anchor="end">${fmt.format(amount/1000000)}</text>`;
    }
    const cursor = new Date(start);
    cursor.setUTCDate(1);
    while (cursor.getTime() <= end) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth()+1);
      if (cursor.getTime() >= start) grid += `<line x1="${x(cursor.getTime())}" x2="${x(cursor.getTime())}" y1="${top}" y2="${height-bottom}" stroke="#d4ddd7"/>`;
      const middle = (Math.max(start, cursor.getTime()) + Math.min(end, next.getTime())) / 2;
      const date = cursor.toISOString();
      grid += `<text class="volume-month-label" x="${x(middle)}" y="${height-8}" text-anchor="middle">${date.slice(5,7)}/${date.slice(2,4)}</text>`;
      cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    const barWidth = Math.max(1, Math.min(12, (width-left-right)*86400000/span*.75));
    const bars = days.map(([date, amount, primary]) => {
      const center = x(Date.parse(date+"T00:00:00Z"));
      const barLeft = Math.max(left, center-barWidth/2);
      const barRight = Math.min(width-right, center+barWidth/2);
      const barW = Math.max(0,barRight-barLeft);
      const primaryHeight = y(0)-y(primary);
      const totalHeight = y(0)-y(amount);
      const dateLabel = date.split("-").reverse().join(".");
      return `<g><rect x="${barLeft}" y="${y(amount)}" width="${barW}" height="${Math.max(0,totalHeight-primaryHeight)}" fill="#5d8979"/><rect x="${barLeft}" y="${y(primary)}" width="${barW}" height="${primaryHeight}" fill="#d1a029"/><title>${dateLabel} · Всего: ${fmt.format(amount)} ₽ · первичное размещение: ${fmt.format(primary)} ₽</title></g>`;
    }).join("");
    const missing = items.some((item) => !(item.points || []).some((p) => p.date >= from && p.date <= to && Number.isFinite(p.turnoverRub)));
    return heading + `<svg class="combined-yields-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Суммарный дневной объём торгов выбранных выпусков">${grid}${bars}</svg>`
      + (missing ? '<p class="volume-heading">Сумма по доступным данным: для части выбранных выпусков объёмы отсутствуют.</p>' : "");
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { colors, renderChart, renderPrice, dailyVolumes, renderVolume, weeklyComparison };
  if (typeof document === "undefined") return;
  const legend = document.querySelector("#combinedYieldLegend");
  const chart = document.querySelector("#combinedYieldChart");
  const priceChart = document.querySelector("#combinedPriceChart");
  const volumeChart = document.querySelector("#combinedVolumeChart");
  if (!legend || !chart || !priceChart || !volumeChart) return;
  function render() {
    if (!state) return;
    legend.innerHTML = state.items.map((item) => `<label class="cashflow-legend-item"><input type="checkbox" data-yield-issue="${item.alias}" ${hidden.has(item.alias) ? "" : "checked"}><span class="cashflow-swatch" style="--issue-color:${colors[item.alias]}"></span>${item.alias}</label>`).join("");
    const selected = state.items.filter((item) => !hidden.has(item.alias));
    chart.innerHTML = renderChart(selected, state.from, state.to);
    priceChart.innerHTML = renderPrice(selected, state.from, state.to);
    volumeChart.innerHTML = renderVolume(selected, state.from, state.to);
  }
  legend.addEventListener("change", (event) => {
    const alias = event.target.dataset?.yieldIssue;
    if (!Object.hasOwn(colors, alias)) return;
    manuallySelected.add(alias);
    if (event.target.checked) hidden.delete(alias); else hidden.add(alias);
    render();
  });
  root.VoxysYields = { update(items, from, to) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    for (const item of items) {
      if (!manuallySelected.has(item.alias) && (item.redeemed || (item.maturityDate && item.maturityDate.slice(0, 10) <= today))) {
        hidden.add(item.alias);
      }
    }
    state = { items, from, to };
    render();
  } };
})(typeof window === "undefined" ? globalThis : window);
