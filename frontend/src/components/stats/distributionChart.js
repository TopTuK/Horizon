import { Interaction } from 'chart.js'
import { MONTHS } from '../../lib/calendar'
import { fmtHours, fmtNum } from '../../lib/planning'
import { withAlpha } from '../../lib/color'

/**
 * Index mode without the zero-height segments. An empty month then has nothing to hover, and the
 * tooltip callbacks never run on an empty item list, which Chart.js does not guard against.
 */
Interaction.modes.allocation = (chart, e, options, useFinalPosition) =>
  Interaction.modes.index(chart, e, options, useFinalPosition).filter(({ datasetIndex, index }) => chart.data.datasets[datasetIndex].data[index] > 0)

const AXIS_TICKS = { color: '#71717a', font: { size: 10 } }

/** % of FTE booked in the month and its hours: "41% · 47 h". */
export const shareLine = (pct, hours) => `${fmtNum(pct, 0)}% · ${fmtHours(hours)} h`

/** Sum of the tooltip items: [pct of FTE, hours]. */
export function sumItems(items) {
  return items.reduce(([p, h], i) => [p + i.parsed.y, h + i.dataset.hours[i.dataIndex]], [0, 0])
}

/**
 * Chart.js data of one allocation histogram (a pool or a member): its activities in stack order,
 * as % of a full workload. `scale` turns a pool's FTE-people into a share of its members.
 */
export function histogramData(alloc, series, { hidden = new Set(), scale = 1, barThickness } = {}) {
  return {
    labels: MONTHS,
    datasets: alloc.acts
      .filter((a) => series?.acts[a.id])
      .map((a) => {
        const s = series.acts[a.id]
        return {
          label: a.name,
          activityId: a.id,
          laneName: a.laneName,
          hours: s.hours,
          // Rounded to 0.01%: 0.2 + 0.8 loads come out as 1.0000000000000002, which would stretch the axis past 100.
          data: s.load.map((v) => Math.round(v * 100 * scale * 100) / 100),
          backgroundColor: withAlpha(a.laneColor, a.shade),
          borderColor: '#18181b',
          borderWidth: 1,
          maxBarThickness: barThickness,
          hidden: hidden.has(a.id),
        }
      }),
  }
}

/**
 * Chart.js options of an allocation histogram: stacked % of FTE with the 100% line in red.
 * `label` formats one activity line of the tooltip, `footer` its total.
 */
export function histogramOptions({ year, label, footer }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    // Top padding keeps the highest tick label (e.g. "100%") inside the canvas.
    layout: { padding: { top: 8 } },
    interaction: { mode: 'allocation', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'allocation',
        callbacks: {
          title: (items) => (items.length ? `${MONTHS[items[0].dataIndex]} ${year()}` : ''),
          label,
          footer: (items) => (items.length ? footer(items) : ''),
        },
      },
    },
    scales: {
      x: { stacked: true, ticks: { ...AXIS_TICKS, maxRotation: 0, autoSkipPadding: 6 }, grid: { display: false } },
      y: {
        stacked: true,
        beginAtZero: true,
        suggestedMax: 100,
        ticks: { ...AXIS_TICKS, padding: 4, stepSize: 50, callback: (v) => v + '%' },
        grid: { color: (c) => (c.tick.value === 100 ? '#f8717188' : '#27272a') },
      },
    },
  }
}
