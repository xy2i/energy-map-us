/* Configuration */
const selector = '.energy-map' // Where to put the chart (CSS selector)

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
  // Configurable properties.
  let energyType = ''
  let energyName = ''
  let color = () => {}
  let legendTitle = ''
  let fontColor = () => {}

  const nameToShortname = new Map([
    ['Alabama', 'Ala.'],
    ['Alaska', 'Alaska'],
    ['Arizona', 'Ariz'],
    ['Arkansas', 'Ark.'],
    ['California', 'Calif.'],
    ['Colorado', 'Colo.'],
    ['Connecticut', 'Conn.'],
    ['Delaware', 'Del.'],
    ['District of Columbia', ''],
    ['Florida', 'Fla.'],
    ['Georgia', 'Ga.'],
    ['Hawaii', 'Hawaii'],
    ['Idaho', 'Idaho'],
    ['Illinois', 'Ill.'],
    ['Indiana', 'Ind.'],
    ['Iowa', 'Iowa'],
    ['Kansas', 'Kan.'],
    ['Kentucky', 'Ky.'],
    ['Louisiana', 'La.'],
    ['Maine', 'Maine'],
    ['Maryland', 'Md.'],
    ['Massachusetts', 'Mass.'],
    ['Michigan', 'Mich.'],
    ['Minnesota', 'Minn.'],
    ['Mississippi', 'Miss.'],
    ['Missouri', 'Mo.'],
    ['Montana', 'Mont.'],
    ['Nebraska', 'Neb.'],
    ['Nevada', 'Nev.'],
    ['New Hampshire', 'N.H.'],
    ['New Jersey', 'N.J.'],
    ['New Mexico', 'N.M'],
    ['New York', 'N.Y'],
    ['North Carolina', 'N.C'],
    ['North Dakota', 'N.D'],
    ['Ohio', 'Ohio'],
    ['Oklahoma', 'Okla.'],
    ['Oregon', 'Ore.'],
    ['Pennsylvania', 'Pa.'],
    ['Rhode Island', 'R.I.'],
    ['South Carolina', 'S.C.'],
    ['South Dakota', 'S.D.'],
    ['Tennessee', 'Tenn.'],
    ['Texas', 'Tex.'],
    ['Utah', 'Utah'],
    ['Vermont', 'Vt.'],
    ['Virginia', 'Va.'],
    ['Washington', 'Wash.'],
    ['West', 'W.Va.'],
    ['Wisconsin', 'Wis.'],
    ['Wyoming', 'Wyo.'],
  ])

  const tip = d3
    .tip()
    .attr('class', 'd3-tip')
    // Display information
    .html(
      (d, i) =>
        `<span class="tooltip-name" style="color:${fontColor}">${energyName}</span>-powered plants account for <br>
        <span class="align">
        <span class="tooltip-value">${d.properties.energyTypes[energyType]}%</span>  
          &nbsp;of energy in&nbsp;
          <span class="tooltip-title">${d.properties.name}</span>.
        </span>
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

  /* Map creation */
  svg
    .append('g')
    .attr('fill', '#ddd')
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
    .attr('id', 'map-strokes')
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('stroke-linejoin', 'round')
    .attr('d', path)

  // States names
  svg
    .append('g')
    .attr('id', 'map-state-names')
    .selectAll('text')
    .data(topojson.feature(data, data.objects.states).features)
    .join((enter) =>
      enter
        .append('text')
        .text((d) => nameToShortname.get(d.properties.name))
        .style('opacity', 0)
        .attr('x', (d) => path.centroid(d)[0])
        .attr('y', (d) => path.centroid(d)[1])
        .attr('text-anchor', 'middle')
        .attr('fill', 'black')
        .attr('font-size', '11pt')
        .style('pointer-events', 'none')
        .style(
          'text-shadow',
          '1px 1px 0px rgba(255,255,255,0.7),-1px -1px 0px rgba(255,255,255,0.7),-1px 1px 0px rgba(255,255,255,0.7),1px -1px 0px rgba(255,255,255,0.7)'
        )
        .call((enter) => enter.transition(t).style('opacity', 1))
    )

  function my() {
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
            .attr('fill', 'white')
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

    // Make sure the strokes are on top.
    svg.select('#map-strokes').raise()
    svg.select('#map-state-names').raise()
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

  my.fontColor = function (value) {
    if (!arguments.length) return fontColor
    fontColor = value
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
  // From an energy type, determine which source to highlight.
  const energyTypeToHighlight = new Map([
    ['coal', 'source_fossil'],
    ['natural_gaz', 'source_fossil'],
    ['oil', 'source_fossil'],
    ['hydro', 'source_renewable'],
    ['geothermic', 'source_renewable'],
    ['solar', 'source_renewable'],
    ['wind', 'source_renewable'],
    ['biomass_other', 'source_renewable'],
    ['nuclear', 'source_nuclear'],
  ])

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
      get color() {
        return this.colorScale(50) // reduce intensity
      },
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
      get color() {
        return this.colorScale(50) // reduce intensity
      },
    },
    {
      energyType: 'natural_gaz',
      name: 'Natural gas',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FFF1C6', '#f78b29']),
      title: 'Share of electricity produced by natural gas-powered plants',
      get color() {
        return this.colorScale(100)
      },
    },
    {
      energyType: 'oil',
      name: 'Oil',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 20])
        .range(['#FFCFC3', '#EE1C25']),
      title: 'Share of electricity produced by oil-powered plants',
      get color() {
        return this.colorScale(10)
      },
    },
    {
      energyType: 'hydro',
      name: 'Hydro',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 50])
        .range(['#C2D5F6', '#0081C5']),
      title: 'Share of electricity produced by hydro-powered plants',
      get color() {
        return this.colorScale(25)
      },
    },
    {
      energyType: 'geothermic',
      name: 'Geothermic',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([0.5, 10])
        .range(['#B3EEF4', '#12B7C5']),
      title: 'Share of electricity produced by geothermic-powered plants',
      get color() {
        return this.colorScale(10)
      },
    },
    {
      energyType: 'solar',
      name: 'Solar',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 20])
        .range(['#F5EEAC', '#D7C944']),
      title: 'Share of electricity produced by solar-powered plants',
      get color() {
        return this.colorScale(20)
      },
    },
    {
      energyType: 'wind',
      name: 'Wind',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 50])
        .range(['#CFF4E5', '#0FB14C']),
      title: 'Share of electricity produced by wind-powered plants',
      get color() {
        return this.colorScale(25) // reduce intensity
      },
    },
    {
      energyType: 'biomass_other',
      name: 'Biomass & other',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 20])
        .range(['#D4E3A1', '#8EAB28']),
      title: 'Share of electricity produced by biomass & other plants',
      get color() {
        return this.colorScale(10)
      },
    },
  ]

  const typesDiv = d3.select('.energy-type')

  // Sources div
  const energySources = [
    {
      energyType: 'source_nuclear',
      name: 'Nuclear',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#F7D0DF', '#cf4a9b']),
      title: 'Share of nuclear sources',
      get color() {
        return this.colorScale(50) // reduce intensity
      },
    },
    {
      energyType: 'source_fossil',
      name: 'Fossil',
      fontColor: 'black',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#FBF9F1', '#CFC17A']),
      title: 'Share of fossil fuel sources',
      get color() {
        return this.colorScale(100)
      },
    },
    {
      energyType: 'source_renewable',
      name: 'Renewable',
      fontColor: 'white',
      colorScale: d3
        .scaleLinear()
        .domain([1, 100])
        .range(['#BFECC4', '#0FA31E']),
      title: 'Share of renewable sources',
      get color() {
        return this.colorScale(50) // reduce intensity
      },
    },
  ]
  const sourcesDiv = d3.select('.energy-sources')

  /* Creation and onclick */
  typesDiv
    .selectAll('.btn')
    .data(energyTypes)
    // Need to use function() form explicity to keep this's scope.
    // Need to use function() form explicity to keep this's scope.
    .on('click', function (d) {
      updateTypes(this, d)
    })

  sourcesDiv
    .selectAll('button')
    .data(energySources)
    .join('button')
    .attr('type', 'button')
    .attr('class', 'btn')
    .style('color', (d) => d.color)
    // Need to use function() form explicity to keep this's scope.
    .on('click', function (d) {
      updateSources(this, d)
    })

  typesDiv
    .selectAll('.btn-text')
    .data(energyTypes)
    .text((d) => d.name)

  sourcesDiv
    .selectAll('.btn-text')
    .data(energySources)
    .text((d) => d.name)

  function updateTypes(
    selection,
    { energyType, name, colorScale, title, color }
  ) {
    const button = d3.select(selection)

    typesDiv.selectAll('button').classed('btn-active', false)
    button.classed('btn-active', true)

    // Set the corresponding energy source as highlighted.
    const highlightedSource = energyTypeToHighlight.get(energyType)
    sourcesDiv.selectAll('button').classed('btn-highlight', false)
    sourcesDiv.selectAll('button').classed('btn-active', false)
    sourcesDiv
      .selectAll('button')
      .data(energySources)
      // Does the matching energy source have the same source as the highlighted?
      .classed('btn-highlight', (d) => d.energyType === highlightedSource)

    // Call the closure, updating the chart.
    chart
      .energyType(energyType)
      .energyName(name)
      .fontColor(color)
      .colorScale(colorScale)
      .legendTitle(title)()
  }

  function updateSources(
    selection,
    { energyType, name, colorScale, title, color }
  ) {
    console.log(selection)
    const button = d3.select(selection)

    typesDiv.selectAll('button').classed('btn-active', false)
    sourcesDiv
      .selectAll('button')
      .classed('btn-active', false)
      .classed('btn-highlight', false)
    button.classed('btn-active', true)

    // Call the closure, updating the chart.
    chart
      .energyType(energyType)
      .energyName(name)
      .fontColor(color)
      .colorScale(colorScale)
      .legendTitle(title)()
  }

  // Initialize.sourcesDiv=
  updateTypes(typesDiv.selectAll('button')._groups[0][0], energyTypes[0])
  //updateSources(energySources[0])
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
