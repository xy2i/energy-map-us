/* Configuration */
const selector = '.energy-map' // Where to put the chart (CSS selector)

// Colors used.
const colors = [
  '#f78b29',
  '#99979a',
  '#cf4a9b',
  '#0081c5',
  '#ee1c25',
  '#0fb14c',
  '#d7c944',
  '#ffefd6',
]

function createCanvas(width, height) {
  var canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function ramp(color, n = 256) {
  const canvas = createCanvas(n, 1)
  const context = canvas.getContext('2d')
  for (let i = 0; i < n; ++i) {
    context.fillStyle = color(i / (n - 1))
    context.fillRect(i, 0, 1, 1)
  }
  return canvas
}

function legend({
  color,
  title,
  tickSize = 6,
  width = 320,
  height = 44 + tickSize,
  marginTop = 18,
  marginRight = 0,
  marginBottom = 16 + tickSize,
  marginLeft = 0,
  ticks = width / 64,
  tickFormat,
  tickValues,
} = {}) {
  const svg = d3
    .create('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .style('overflow', 'visible')
    .style('display', 'block')

  let tickAdjust = (g) =>
    g.selectAll('.tick line').attr('y1', marginTop + marginBottom - height)
  let x

  // Continuous
  if (color.interpolate) {
    const n = Math.min(color.domain().length, color.range().length)

    x = color
      .copy()
      .rangeRound(
        d3.quantize(d3.interpolate(marginLeft, width - marginRight), n)
      )

    svg
      .append('image')
      .attr('x', marginLeft)
      .attr('y', marginTop)
      .attr('width', width - marginLeft - marginRight)
      .attr('height', height - marginTop - marginBottom)
      .attr('preserveAspectRatio', 'none')
      .attr(
        'xlink:href',
        ramp(
          color.copy().domain(d3.quantize(d3.interpolate(0, 1), n))
        ).toDataURL()
      )
  }

  // Sequential
  else if (color.interpolator) {
    x = Object.assign(
      color
        .copy()
        .interpolator(d3.interpolateRound(marginLeft, width - marginRight)),
      {
        range() {
          return [marginLeft, width - marginRight]
        },
      }
    )

    svg
      .append('image')
      .attr('x', marginLeft)
      .attr('y', marginTop)
      .attr('width', width - marginLeft - marginRight)
      .attr('height', height - marginTop - marginBottom)
      .attr('preserveAspectRatio', 'none')
      .attr('xlink:href', ramp(color.interpolator()).toDataURL())

    // scaleSequentialQuantile doesn’t implement ticks or tickFormat.
    if (!x.ticks) {
      if (tickValues === undefined) {
        const n = Math.round(ticks + 1)
        tickValues = d3
          .range(n)
          .map((i) => d3.quantile(color.domain(), i / (n - 1)))
      }
      if (typeof tickFormat !== 'function') {
        tickFormat = d3.format(tickFormat === undefined ? ',f' : tickFormat)
      }
    }
  }

  // Threshold
  else if (color.invertExtent) {
    const thresholds = color.thresholds
      ? color.thresholds() // scaleQuantize
      : color.quantiles
      ? color.quantiles() // scaleQuantile
      : color.domain() // scaleThreshold

    const thresholdFormat =
      tickFormat === undefined
        ? (d) => d
        : typeof tickFormat === 'string'
        ? d3.format(tickFormat)
        : tickFormat

    x = d3
      .scaleLinear()
      .domain([-1, color.range().length - 1])
      .rangeRound([marginLeft, width - marginRight])

    svg
      .append('g')
      .selectAll('rect')
      .data(color.range())
      .join('rect')
      .attr('x', (d, i) => x(i - 1))
      .attr('y', marginTop)
      .attr('width', (d, i) => x(i) - x(i - 1))
      .attr('height', height - marginTop - marginBottom)
      .attr('fill', (d) => d)

    tickValues = d3.range(thresholds.length)
    tickFormat = (i) => thresholdFormat(thresholds[i], i)
  }

  // Ordinal
  else {
    x = d3
      .scaleBand()
      .domain(color.domain())
      .rangeRound([marginLeft, width - marginRight])

    svg
      .append('g')
      .selectAll('rect')
      .data(color.domain())
      .join('rect')
      .attr('x', x)
      .attr('y', marginTop)
      .attr('width', Math.max(0, x.bandwidth() - 1))
      .attr('height', height - marginTop - marginBottom)
      .attr('fill', color)

    tickAdjust = () => {}
  }

  svg
    .append('g')
    .attr('transform', `translate(0,${height - marginBottom})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(ticks, typeof tickFormat === 'string' ? tickFormat : undefined)
        .tickFormat(typeof tickFormat === 'function' ? tickFormat : undefined)
        .tickSize(tickSize)
        .tickValues(tickValues)
    )
    .call(tickAdjust)
    .call((g) => g.select('.domain').remove())
    .call((g) =>
      g
        .append('text')
        .attr('x', marginLeft)
        .attr('y', marginTop + marginBottom - height - 6)
        .attr('fill', 'currentColor')
        .attr('text-anchor', 'start')
        .attr('font-weight', 'bold')
        .text(title)
    )

  return svg.node()
}

/*
 * data: bubble map data. See data/energy.csv for the schema.
 * geo: US map TopoJSON
 *
 * Transform them into one single dataset.
 */
function transform([data, us]) {
  console.log(topojson.feature(us, us.objects.states).features)
  console.log('data', data)

  const states = topojson.feature(us, us.objects.states).features
  /*
   * Create a new property and append the energy types to it.
   * Later, when we create the chart, the structure will be very convenient
   * for accessing data directly.
   */
  states.forEach((geoJsonObject, i) => {
    const stateEnergyTypes = data.find(
      (d) => geoJsonObject.properties.name === d.state
    )
    geoJsonObject.properties.energyTypes = stateEnergyTypes
  })

  return us
}

/*
 * data is a mix of the US map GeoJSON and the actual data.
 */
function chart(data) {
  console.info(data)
  console.log(topojson.feature(data, data.objects.states).features)

  const tip = d3
    .tip()
    .attr('class', 'd3-tip')
    // Display information
    .html(
      (d, i) =>
        `<span class="tooltip-title">${d.properties.name}</span><br>
        <span class="tooltip-value">${
          d.properties.energyTypes[energyType]
        }% <span class="tooltip-name" style="color:${color(
          100
        )}">${energyName}</span></span>
        </div>`
    )

  const path = d3.geoPath()

  const format = (d) => `${d}%`

  const svg = d3
    .select(selector)
    .append('svg')
    .attr('viewBox', [0, 0, 975, 610])
    .call(tip) // Required to call in the vis context, to display the tooltip

  // Transition.
  const t = d3.transition().duration(500).ease(d3.easeExp)

  // Configurable properties.
  let energyType = 'nuclear'
  let energyName = 'Nuclear'
  let color = d3.scaleLinear().domain([1, 100]).range(['#F7D0DF', '#cf4a9b'])
  let legendTitle = 'Share of electricity produced by nuclear-powered plants'

  // Render once:
  /* Map creation */
  svg
    .append('g')
    .attr('fill', '#666')
    .attr('id', 'map')
    .selectAll('path')
    .data(topojson.feature(data, data.objects.states).features)
    .enter()
    .append('path')
    .attr('d', path)

  // States strokes
  svg
    .append('path')
    .datum(topojson.mesh(data, data.objects.states, (a, b) => a !== b))
    .attr('fill', 'none')
    .attr('stroke', '#666')
    .attr('stroke-width', 0)
    .attr('stroke-linejoin', 'round')
    .attr('d', path)

  function my() {
    console.log('render called, colorscale:', color(1))

    // Remove and re-append legend.
    svg
      .select('.legend')
      .call((legend) => legend.transition(t).attr('opacity', 0).remove())

    svg
      .append('g')
      .attr('class', 'legend')
      .attr('transform', 'translate(610,20)')
      .attr('opacity', 0)
      .call((legend) => legend.transition(t).attr('opacity', 1))
      .append(() =>
        legend({ color, title: legendTitle, width: 260, tickFormat: format })
      )

    // Fill color & text
    svg
      .selectAll('#color')
      .data([null])
      .join('g')
      .attr('id', 'color')
      .selectAll('path')
      .data(topojson.feature(data, data.objects.states).features, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('path')
            .call((enter) =>
              enter
                .transition(t)
                .attr('fill', (d) =>
                  color(d.properties.energyTypes[energyType])
                )
            ),
        (update) =>
          update
            .transition(t)
            .attr('fill', (d) => color(d.properties.energyTypes[energyType]))
      )
      .attr('d', path)
      .on('mouseover', tip.show)
      .on('mouseout', tip.hide)
  }

  my.energyType = function (value) {
    if (!arguments.length) return energyType
    energyType = value
    return my
  }

  my.energyName = function (value) {
    if (!arguments.length) return energyName
    energyName = value
    return my
  }

  my.colorScale = function (value) {
    if (!arguments.length) return color
    color = value
    return my
  }

  my.legendTitle = function (value) {
    if (!arguments.length) return legendTitle
    legendTitle = value
    return my
  }

  return my
}

// Controls the chart closure and makes buttons.
function control(chart) {
  const energyTypes = [
    {
      energyType: 'nuclear',
      name: 'Nuclear',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#F7D0DF', '#cf4a9b']),
      title: 'Share of electricity produced by nuclear-powered plants',
    },
    {
      energyType: 'coal',
      name: 'Coal',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#E7E6E7', '#99979A']),
      title: 'Share of electricity produced by coal-powered plants',
    },
    {
      energyType: 'natural_gaz',
      name: 'Natural gaz',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FFF1C6', '#f78b29']),
      title: 'Share of electricity produced by natural gaz-powered plants',
    },
    {
      energyType: 'oil',
      name: 'Oil',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FFCFC3', '#EE1C25']),
      title: 'Share of electricity produced by oil-powered plants',
    },
    {
      energyType: 'hydro',
      name: 'Hydro',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#C2D5F6', '#0081C5']),
      title: 'Share of electricity produced by hydro-powered plants',
    },
    {
      energyType: 'geothermic',
      name: 'Geothermic',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#DDF2FF', '#12DCFF']),
      title: 'Share of electricity produced by geothermic-powered plants',
    },
    {
      energyType: 'solar',
      name: 'Solar',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#F6FBD8', '#D7C944']),
      title: 'Share of electricity produced by solar-powered plants',
    },
    {
      energyType: 'wind',
      name: 'Wind',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#CFF4E5', '#0FB14C']),
      title: 'Share of electricity produced by wind-powered plants',
    },
    {
      energyType: 'biomass_other',
      name: 'Biomass & other',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FFF3E3', '#FFE2D6']),
      title: 'Share of electricity produced by biomass & other plants',
    },
  ]
  const typesDiv = d3.select('.energy-type')

  typesDiv
    .selectAll('button')
    .data(energyTypes)
    .join('button')
    .attr('type', 'button')
    .attr('class', 'pure-button')
    .style('background-color', (d) => d.colorScale(100))
    .style('color', (d) => d.fontColor)
    .text((d) => d.name)
    .on('click', ({ energyType, name, colorScale, title }) => {
      chart
        .energyType(energyType)
        .energyName(name)
        .colorScale(colorScale)
        .legendTitle(title)()
    })

  const energySources = [
    {
      energyType: 'source_fossil',
      name: 'Fossil',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FBF9F1', '#CFC17A']),
      title: 'Share of fossil fuel sources',
    },
    {
      energyType: 'source_renewable',
      name: 'Renewable',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#EAF3FD', '#3B8AD8']),
      title: 'Share of renewable sources',
    },
    {
      energyType: 'source_nuclear',
      name: 'Nuclear',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#F7D0DF', '#cf4a9b']),
      title: 'Share of nuclear sources',
    },
  ]
  const sourcesDiv = d3.select('.energy-sources')

  sourcesDiv
    .selectAll('button')
    .data(energySources)
    .join('button')
    .attr('type', 'button')
    .attr('class', 'pure-button')
    .style('background-color', (d) => d.colorScale(100))
    .style('color', (d) => d.fontColor)
    .text((d) => d.name)
    .on('click', ({ energyType, name, colorScale, title }) => {
      chart
        .energyType(energyType)
        .energyName(name)
        .colorScale(colorScale)
        .legendTitle(title)()
    })
}

// Load all the data before continuing.
Promise.all([
  d3.csv('data/dataset.csv', d3.autoType),
  d3.json('data/states-albers-10m.json'),
])
  .then((data) => transform(data))
  .then((data) => {
    // Returns a closure. Renders when closure is called
    const map = chart(data)
    // Draw the control buttons.
    control(map)
    // Initial render.
    map()
  })
  .catch((error) => {
    console.error('[d3]', error)
  })
