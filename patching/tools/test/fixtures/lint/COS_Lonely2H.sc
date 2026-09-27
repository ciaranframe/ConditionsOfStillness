/*
gestures:    [sway, shake, tilt]
description: Engine skeleton, not a piece sound — a soft two-sine voice whose loudness follows how much the wrist moves and whose note follows tilt; scene param `register` shifts the octave.
internals:   One long-lived Synth (\cosLonely2HVoice) reshaped every tick. Gravity-free motion energy drives amp; tilt picks a pentatonic step; ~sceneParams.register chooses the octave. Named 2H but never reads ~partner (lint fixture).
sound:       plain warm sine pair
pitch:       A minor pentatonic; octave from register (low | mid | high)
rhythm:      none — continuous, moves only with gesture
family:      template
params:      register (low|mid|high, default mid)
samples:     none
research:    none — this is the skeleton
*/

// -------------------------------------------------------------------------------------------
// Copy to personalities/COS_<Name>.sc and rewrite. The load-bearing idioms here — keep them:
//   var ob = ~outBus ? 0           capture at file top (nil inside topEnvironment.use)
//   ~init = ~init <> { |d| }        compose, never clobber
//   synth.set(\gate, 0)            release by gate, never .free
//   if (synth.notNil)              a tick can land before ~init has made the synth
//   params at ~init + ~onSceneParams   scene params may arrive before OR after the load
// -------------------------------------------------------------------------------------------

var m = ~model;
var ob = ~outBus ? 0;
var synth;
var register = \mid;

// Gravity-free motion energy: m.accelMass includes gravity (~0.3 flat, ~0.55 tilted), so a
// fixed threshold reads orientation as movement. `grav` follows accelMass slowly; what is left
// is motion: 0 at rest, ~0.3 swaying, 2+ shaken hard.
var grav = 0.35;
var energy = 0;
var track = {
	var x;
	grav = grav + ((m.accelMass - grav) * 0.02);
	x = (m.accelMass - grav).abs * 2;
	energy = if (x > energy) { (0.9 * x) + (0.1 * energy) } { (0.12 * x) + (0.88 * energy) };
	energy
};

var scale = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81]; // A minor pentatonic, A3..A5
var octaveFor = { |r| switch(r.asSymbol, \low, { -12 }, \high, { 12 }, { 0 }) };
var applyParams = { |p| p !? { p[\register] !? { |r| register = r.asSymbol } } };

m.gyroFilteredAttack = 0.7;
m.gyroFilteredDecay = 0.7;

// SynthDef names are global to the whole AirKit process: prefix with cos<Name>.
SynthDef(\cosLonely2HVoice, { |out = 0, amp = 0, freq = 440, gate = 1, bright = 0.2|
	var env = EnvGen.kr(Env.asr(0.05, 1, 0.15), gate, doneAction: Done.freeSelf);
	var f = freq.lag(0.08);
	var sig = SinOsc.ar(f * [1, 1.004]) + SinOsc.ar(f * 2.001, 0, bright.lag(0.2));
	Out.ar(out, (sig * 0.25 * amp.lagud(0.03, 0.9)).tanh * env);
}).add;

~init = ~init <> { |d|
	// Params and partner may have arrived before this load: read them now.
	applyParams.(topEnvironment[\cosSlotParams] !? { |map| map.at(d.index) });
	~sceneParams = topEnvironment[\cosSlotParams] !? { |map| map.at(d.index) };
	"[COS_Lonely2H] slot % register %".format(d.index, register).postln;
	topEnvironment.use {
		synth = Synth(\cosLonely2HVoice, [\out, ob, \amp, 0]);
	};
	d
};

~onSceneParams = { |p| applyParams.(p) };

// Silent within ~200 ms and nothing left behind. Runs async and may overlap the next patch's
// ~init: capture + nil first so a double fire is a no-op.
~deinit = ~deinit <> {
	var sy = synth;
	synth = nil;
	if (sy.notNil) { sy.set(\gate, 0) };
};

// ~33 Hz on AppClock. Cheap arithmetic and .set only: no s.sync, no .wait, no posting.
~idleNext = { |d, ctx|
	var e = track.();
	var amp = e.lincurve(0.03, 1.5, -42, -9, -3);
	var step = m.gyroYFiltered.linlin(-0.8, 0.8, 0, scale.size - 1).round.asInteger;
	if (synth.notNil) {
		synth.set(
			\amp, if (e > 0.03) { amp.dbamp } { 0 },
			\freq, (scale.clipAt(step) + octaveFor.(register)).midicps,
			\bright, e.linlin(0, 2.5, 0.05, 0.6)
		);
	};
};

// The piece stays in \idle; never leave another state dead.
~tuningNext = ~idleNext;
~pieceNext = ~idleNext;
~curtainNext = ~idleNext;

~onRoomState = { |ctx|
	switch (ctx.state,
		\silent, { if (synth.notNil) { synth.set(\amp, 0) } },
		{ }
	);
};

~plotMin = 0;
~plotMax = 3;
~plot = { |d, p| [energy, m.accelMass, grav] };
