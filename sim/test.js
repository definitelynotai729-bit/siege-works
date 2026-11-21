const pl = require('planck'); const SW = require('./core.js');
for (const f of SW.sampleForts()) {
  const code = SW.encodeFort(f.name, f.pieces); const back = SW.decodeFort(code);
  const sim = SW.createSim(pl, back.pieces, []);
  for (let i=0;i<600;i++) sim.step();
  const dead = sim.blocks.filter(b=>!b.alive).length, maxd = Math.max(...sim.blocks.map(b=>b.dmg/b.hp));
  // random search for breaching plans
  let wins=0, tries=300, best=1e9;
  for (let k=0;k<tries;k++){
    const plan=[]; let t=SW.SETTLE; const types=['stone','stone','stone','boulder','pot'];
    for (const ty of types){ plan.push({type:ty,t, a:10+Math.random()*60, p:0.45+Math.random()*0.55}); t+=150; }
    const s=SW.createSim(pl, back.pieces, plan); let o=null;
    while(!(o=s.outcome()) && s.tick<4000) s.step();
    if(o==='breached'){wins++; best=Math.min(best, s.fired.length);}
  }
  console.log(f.name.padEnd(14),'cost',SW.fortCost(f.pieces),'pieces',f.pieces.length,'idleDead',dead,'maxIdleDmg',maxd.toFixed(2),'randomBreach',wins+'/'+tries,'minShots',best);
}
// determinism
const f=SW.sampleForts()[0]; const plan=[{type:'boulder',t:100,a:33,p:0.8},{type:'pot',t:300,a:40,p:0.75}];
const run=()=>{const s=SW.createSim(pl,f.pieces,plan.map(x=>({...x})));while(s.tick<1500)s.step();return SW.stateHash(s)};
console.log('hash',run(),run());
console.log(SW.decodePlan(SW.encodePlan(plan)));
