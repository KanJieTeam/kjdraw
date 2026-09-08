// Original synthetic geometry for the public KJDraw project.
// This is an invented resilient-energy campus: no survey data, client drawing,
// private Kanjie module, or third-party asset is embedded in the sample.
export async function createSample(sdk) {
  const document = sdk.createDocument({
    documentId: 'sample-resilient-campus',
    title: 'Resilient energy campus / coordination plan',
    units: 'meter',
  })
  const entities = []
  const add = (type, payload, layerName, options) => entities.push({ type, layerName, payload, options })
  const line = (start, end, layerName) => add('LINE', { start, end }, layerName)
  const circle = (center, radius, layerName) => add('CIRCLE', { center, radius }, layerName)
  const text = (position, content, height, layerName = 'Annotations', rotation = 0) => add('TEXT', { position, text: content, height, rotation }, layerName)
  const poly = (points, layerName, closed = true) => add('LWPOLYLINE', { vertices: points.map(point => ({ point })), closed }, layerName)
  const rect = (x, y, width, height, layerName) => poly([[x,y],[x+width,y],[x+width,y+height],[x,y+height]], layerName)
  const cross = (x, y, radius, layerName) => {
    line([x-radius,y],[x+radius,y],layerName)
    line([x,y-radius],[x,y+radius],layerName)
  }

  const layers = [
    ['Site boundary',8], ['Road & access',7], ['Buildings',4], ['Solar modules',2],
    ['Energy network',5], ['Landscape',6], ['Topography',8], ['Survey control',3],
    ['Annotations',7], ['Equipment · Rev A',3], ['Temporary · remove',1], ['Safety · proposal',4],
  ]
  for (const [name, color] of layers) await sdk.executeCommand('LAYERNEW', { name, color })

  // Sheet, site boundary and setbacks.
  rect(-8,-14,276,174,'Site boundary')
  rect(0,0,252,148,'Site boundary')
  rect(5,5,242,138,'Site boundary')
  for (const [x,y,label] of [[0,0,'CP-01'],[252,0,'CP-02'],[252,148,'CP-03'],[0,148,'CP-04']]) {
    circle([x,y],1.05,'Survey control'); cross(x,y,1.8,'Survey control'); text([x+2.2,y+1.3],label,1.25,'Survey control')
  }

  // Soft, synthetic contours create a legible civil base without external data.
  for (let row=0; row<42; row++) {
    const y=7+row*3.25
    const points=[]
    for (let col=0; col<=28; col++) {
      const x=4+col*8.7
      points.push([x,y+Math.sin(col*.55+row*.31)*1.6+Math.cos(col*.18-row*.23)*.7])
    }
    poly(points,'Topography',false)
    if (row%7===0) text([7,y+2],`${42+row}.00`,.9,'Topography')
  }

  // Primary loop road, emergency lane and lane markings.
  rect(8,10,236,127,'Road & access')
  rect(13,15,226,117,'Road & access')
  rect(119,16,69,48,'Road & access')
  rect(124,21,59,38,'Road & access')
  for(let x=18;x<=232;x+=7) line([x,12.5],[Math.min(x+3.8,236),12.5],'Road & access')
  for(let x=18;x<=232;x+=7) line([x,134.5],[Math.min(x+3.8,236),134.5],'Road & access')
  for(let y=22;y<=126;y+=7) line([10.5,y],[10.5,Math.min(y+3.8,130)],'Road & access')
  for(let y=22;y<=126;y+=7) line([241.5,y],[241.5,Math.min(y+3.8,130)],'Road & access')
  text([16,17],'EMERGENCY LOOP  /  6.0 m',1.15,'Annotations')

  // Operations building, workshop and internal structural grid.
  rect(26,24,82,38,'Buildings'); rect(27.2,25.2,79.6,35.6,'Buildings')
  rect(30,28,28,29,'Buildings'); rect(61,28,42,29,'Buildings')
  for(let x=34;x<104;x+=7) line([x,26],[x,61],'Buildings')
  for(let y=32;y<59;y+=6) line([27,y],[107,y],'Buildings')
  rect(30,19,73,3,'Energy network')
  for(let x=32;x<102;x+=4.8) circle([x,20.5],.55,'Energy network')
  text([32,48],'OPERATIONS + LAB',2.4,'Annotations')
  text([32,44.5],'BUILDING 01  /  2 980 m²',1.15,'Annotations')

  // Visitor parking and accessible bays.
  rect(18,66,92,9,'Road & access')
  for(let x=20;x<=108;x+=2.75) {
    line([x,66],[x+1.45,75],'Road & access')
    line([x+1.45,75],[x+2.1,75],'Road & access')
  }
  for(let x=21;x<107;x+=11) text([x,69.2],'P',1.05,'Annotations')

  // Two dense photovoltaic fields. Each module remains an independently
  // selectable/editable public SDK entity, making the sample non-trivial.
  const solarField = (originX, label) => {
    rect(originX-2,80,99,56,'Energy network')
    for(let row=0;row<14;row++) {
      for(let col=0;col<28;col++) {
        const x=originX+col*3.45, y=82+row*3.65
        rect(x,y,2.75,2.55,'Solar modules')
        line([x+1.375,y],[x+1.375,y+2.55],'Solar modules')
      }
    }
    for(let row=0;row<14;row++) line([originX-1,83.3+row*3.65],[originX+95.8,83.3+row*3.65],'Energy network')
    text([originX,138.5],`${label}  /  392 MODULES`,1.35,'Annotations')
  }
  solarField(17,'PV ARRAY A')
  solarField(133,'PV ARRAY B')

  // Substation and distribution network.
  rect(114,68,22,8,'Energy network'); rect(116,69.5,8,5,'Energy network'); rect(126,69.5,8,5,'Energy network')
  for(let x=117;x<=133;x+=4) { circle([x,72],.7,'Energy network'); cross(x,72,1.1,'Energy network') }
  poly([[125,75],[125,79],[65,79],[65,81]],'Energy network',false)
  poly([[129,75],[129,78],[181,78],[181,81]],'Energy network',false)
  text([116,77],'MV SUBSTATION',1.05,'Annotations')

  // East service yard. Dedicated layers make the deterministic Agent demo
  // discoverable without hidden IDs or product-specific data.
  rect(190,19,54,48,'Buildings')
  text([193,64],'EAST SERVICE YARD  /  REV A',1.25,'Annotations')
  for(let row=0;row<2;row++) for(let col=0;col<4;col++) {
    const x=197+col*10.2,y=25+row*10.5
    rect(x,y,7.4,6.3,'Equipment · Rev A')
    line([x+1,y+1.2],[x+6.4,y+1.2],'Equipment · Rev A')
    line([x+1,y+3.15],[x+6.4,y+3.15],'Equipment · Rev A')
    line([x+1,y+5.1],[x+6.4,y+5.1],'Equipment · Rev A')
  }
  text([198,47.5],'BATTERY BANKS  B01—B08',1.1,'Equipment · Rev A')
  rect(193,52,47,11,'Temporary · remove')
  for(let x=195;x<239;x+=4) line([x,52],[Math.min(x+6,240),63],'Temporary · remove')
  text([195,57],'TEMPORARY STAGING',1.05,'Temporary · remove')

  // Site furniture and planting—small, editable objects rather than one image.
  for(let i=0;i<58;i++) {
    const side=i%2, band=Math.floor(i/2)
    const x=side?235:17, y=18+(band%29)*3.9
    circle([x,y],1.15,'Landscape'); circle([x,y],.38,'Landscape'); cross(x,y,.75,'Landscape')
  }
  for(let i=0;i<24;i++) {
    const x=113+(i%4)*7.5,y=24+Math.floor(i/4)*6.1
    circle([x,y],.35,'Landscape')
  }

  // Survey/control network and coordinate grid references.
  for(let i=0;i<12;i++) {
    const x=18+i*19.1,y=i%2?7:142
    circle([x,y],.65,'Survey control'); cross(x,y,1.25,'Survey control'); text([x+1.5,y+.7],`SP-${String(i+1).padStart(2,'0')}`,.85,'Survey control')
  }
  for(let x=25;x<236;x+=25) { line([x,4],[x,6],'Annotations'); text([x-1.7,1.4],String(x),.85,'Annotations') }
  for(let y=25;y<136;y+=25) { line([246,y],[248,y],'Annotations'); text([249,y-.4],String(y),.85,'Annotations') }

  // North arrow, scale bar and title block.
  line([255,122],[255,139],'Annotations'); line([255,139],[253.2,135.4],'Annotations'); line([255,139],[256.8,135.4],'Annotations')
  text([253.8,141],'N',2,'Annotations')
  for(let i=0;i<5;i++) rect(8+i*10,-6,10,2.2,'Annotations')
  text([8,-2.4],'0     10     20     30     40     50 m',.9,'Annotations')
  rect(126,-12,140,10,'Annotations')
  line([182,-12],[182,-2],'Annotations'); line([226,-12],[226,-2],'Annotations')
  text([130,-6.3],'RESILIENT ENERGY CAMPUS',2.05,'Annotations')
  text([185,-5.5],'COORDINATION PLAN',1.25,'Annotations')
  text([229,-5.5],'KJ / DEMO 001',1.1,'Annotations')
  text([-7,153],'KJDRAW  /  ORIGINAL SYNTHETIC ENGINEERING SAMPLE  /  METERS',1.55,'Annotations')

  await sdk.executeCommand('CREATEBATCH', { entities })
  // Reopen the generated baseline so Undo starts with the visitor's first edit,
  // not with the internal commands used to assemble the sample.
  const baseline = document.toJSON()
  sdk.closeDocument(document.id)
  return sdk.openDocument(baseline)
}
