(function (root) {
  const colors = { "МКАОВокс01": "#276b51", "МКАОВокс02": "#d1a029", "МКАОВокс03": "#8b626e", "Воксис-01": "#468b9b", "Воксис-02": "#8b9a52", "Воксис-03": "#cc7054", "Воксис-04": "#6579a4" };
  const hidden = new Set();
  const manuallySelected = new Set();
  let state;
  function renderChart(items, from, to) {
    const series = items.map((item) => ({ ...item, points: (item.points || []).filter((p) => p.date >= from && p.date <= to && Number.isFinite(p.ytm)) }));
    const values = series.flatMap((item) => item.points.map((p) => p.ytm));
    if (!values.length) return '<p class="cashflow-empty">Нет данных для выбранных выпусков.</p>';
    const min = Math.floor(Math.min(...values) / 2) * 2;
    const max = Math.max(min + 2, Math.ceil(Math.max(...values) / 2) * 2);
    const width = 1000, height = 340, left = 56, right = 22, top = 20, bottom = 38;
    const timestamp = (date) => Date.parse(date + "T00:00:00Z");
    const start = timestamp(from), span = Math.max(1, timestamp(to) - start);
    const x = (date) => left + (timestamp(date) - start) / span * (width - left - right);
    const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
    const ticks = [];
    for (let v = min; v <= max; v += 2) ticks.push(`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e8df"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${v}%</text>`);
    const cursor = new Date(timestamp(from));
    cursor.setUTCDate(1);
    if (cursor.getTime() < start) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    while (cursor.getTime() <= timestamp(to)) {
      const date = cursor.toISOString().slice(0, 10);
      ticks.push(`<line class="yield-month-divider" x1="${x(date)}" x2="${x(date)}" y1="${top}" y2="${height-bottom}" stroke="#d4ddd7" stroke-width="1" vector-effect="non-scaling-stroke"/><text x="${x(date)}" y="${height-12}" text-anchor="middle">${date.slice(5,7)}/${date.slice(2,4)}</text>`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const lines = series.map((item) => {
      const color = colors[item.alias] || "#777";
      const path = item.points.map((p, i) => `${i ? "L" : "M"}${x(p.date)} ${y(p.ytm)}`).join(" ");
      const points = item.points.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.ytm)}" r="6" fill="transparent" stroke="transparent"><title>${item.alias} · ${p.date.split("-").reverse().join(".")} · ${p.ytm.toFixed(2).replace(".", ",")}%</title></circle>`).join("");
      return `<g style="--line-color:${color}"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>${points}</g>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Доходности всех выбранных выпусков" class="combined-yields-svg">${ticks.join("")}${lines}</svg>`;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { colors, renderChart };
  if (typeof document === "undefined") return;
  const legend = document.querySelector("#combinedYieldLegend");
  const chart = document.querySelector("#combinedYieldChart");
  if (!legend || !chart) return;
  function render() {
    if (!state) return;
    legend.innerHTML = state.items.map((item) => `<label class="cashflow-legend-item"><input type="checkbox" data-yield-issue="${item.alias}" ${hidden.has(item.alias) ? "" : "checked"}><span class="cashflow-swatch" style="--issue-color:${colors[item.alias]}"></span>${item.alias}</label>`).join("");
    chart.innerHTML = renderChart(state.items.filter((item) => !hidden.has(item.alias)), state.from, state.to);
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
      if (!manuallySelected.has(item.alias) && item.maturityDate && item.maturityDate.slice(0, 10) <= today) {
        hidden.add(item.alias);
      }
    }
    state = { items, from, to };
    render();
  } };
})(typeof window === "undefined" ? globalThis : window);
