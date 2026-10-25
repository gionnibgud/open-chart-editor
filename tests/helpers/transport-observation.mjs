// Read-only engine-level observation; explicitly not an independent audio clock.
export function observeTransportClock(engine,advanceTransport,distanceAtTime){
 const before=engine.context.currentTime,observed=engine.currentTime,after=engine.context.currentTime;
 const expected=engine.playing?advanceTransport(engine.position,distanceAtTime(Math.max(0,before-engine.startedAt),engine.speed,engine.ramp),engine.loop,engine.duration):engine.position,coherent=engine.playing?engine.timeAtContext(before):engine.position;
 const lower=engine.playing?engine.timeAtContext(before):engine.position,upper=engine.playing?engine.timeAtContext(after):engine.position;
 const epsilon=1e-7,loop=engine.loop,travel=distanceAtTime(Math.max(0,after-engine.startedAt),engine.speed,engine.ramp)-distanceAtTime(Math.max(0,before-engine.startedAt),engine.speed,engine.ramp),fullLoop=loop?.enabled&&travel>=loop.end-loop.start;
 const inBounds=fullLoop?observed>=loop.start-epsilon&&observed<=loop.end+epsilon:loop?.enabled&&upper<lower?(observed>=lower-epsilon&&observed<=loop.end+epsilon)||(observed>=loop.start-epsilon&&observed<=upper+epsilon):observed>=lower-epsilon&&observed<=upper+epsilon;
 return{clockReadBefore:before,clockReadAfter:after,clockGetterObserved:observed,clockExpectedBefore:lower,clockExpectedAfter:upper,clockError:Math.abs(coherent-expected),clockSequentialResidual:Math.abs(observed-lower),clockGetterWithinBounds:Number.isFinite(observed)&&after>=before&&inBounds};
}
