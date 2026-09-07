// Original synthetic geometry for the public KJDraw project; no survey data or third-party assets.
export async function createSample(sdk) {
  const document = sdk.createDocument({ documentId: 'sample-field-station', title: 'Field station / concept plan', units: 'meter' })
  const entities = []
  const line = (a, b, layerName) => entities.push({ type: 'LINE', layerName, payload: { start: a, end: b } })
  const text = (position, content, height, layerName = 'Annotations') => entities.push({ type: 'TEXT', layerName, payload: { position, text: content, height } })
  const rect = (x, y, w, h, layer) => {
    for (const [a,b] of [[[x,y],[x+w,y]],[[x+w,y],[x+w,y+h]],[[x+w,y+h],[x,y+h]],[[x,y+h],[x,y]]]) line(a,b,layer)
  }
  for (const [name, color] of [['Site boundary',8],['Structure',4],['Survey points',3],['Annotations',7]]) await sdk.executeCommand('LAYERNEW', { name, color })
  rect(0,0,120,74,'Site boundary')
  rect(12,14,78,43,'Structure'); rect(13,15,76,41,'Structure')
  line([42,15],[42,56],'Structure'); line([65,15],[65,56],'Structure')
  line([13,36],[89,36],'Structure'); line([42,35],[89,35],'Structure')
  rect(96,20,13,28,'Structure')
  for (let x=17;x<87;x+=7) { rect(x,17,3.5,6,'Structure'); rect(x,46,3.5,6,'Structure') }
  for (const [i,p] of [[0,[6,7]],[1,[36,7]],[2,[66,7]],[3,[96,7]],[4,[6,65]],[5,[36,65]],[6,[66,65]],[7,[96,65]]]) {
    entities.push({ type:'CIRCLE',layerName:'Survey points', payload:{center:p,radius:1.3} })
    line([p[0]-2.2,p[1]],[p[0]+2.2,p[1]],'Survey points'); line([p[0],p[1]-2.2],[p[0],p[1]+2.2],'Survey points')
    text([p[0]+2.5,p[1]+1.5],`BH-0${i+1}`,1.7,'Survey points')
  }
  text([18,40],'OBSERVATION',1.8); text([46,40],'LAB 01',1.8); text([69,40],'LAB 02',1.8)
  text([18,29],'FIELD STATION',2.4); text([47,29],'RESEARCH / 01',1.6)
  text([97,33],'STORE',1.5)
  line([12,60],[90,60],'Annotations'); line([12,58.5],[12,61.5],'Annotations'); line([90,58.5],[90,61.5],'Annotations')
  text([47,61.5],'78.00 m',1.6)
  line([113,55],[113,66],'Annotations'); line([113,66],[111.5,63],'Annotations'); line([113,66],[114.5,63],'Annotations'); text([112.2,68],'N',2)
  text([0,81],'FIELD STATION',3.7); text([0,77.4],'SYNTHETIC ENGINEERING SAMPLE  /  METERS',1.6)
  text([0,-6],'KJDRAW  /  OPEN ENGINEERING',1.8); text([77,-6],'CONCEPT PLAN   •   01',1.8)
  await sdk.executeCommand('CREATEBATCH', { entities })
  return document
}
