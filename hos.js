// Load Sheet driver log engine, shared by the app (index.html) and the office page (office.html).
// Pure functions only: no storage, no DOM. Works on a list of duty-status changes:
//   {id, at: ISO time, status: "off" | "sb" | "d" | "on", truck, trailer, lat, lng, place, odo, note}
// Rules modeled (property-carrying CMV, FMCSA part 395):
//   11 hours driving and a 14-hour window after 10 hours in a row off duty (off + sleeper)
//   30-minute break after 8 hours of driving (full-log days only; short-haul days are exempt)
//   60 hours / 7 days or 70 hours / 8 days, reset by 34 hours in a row off duty
//   Short-haul (395.1(e)(1)): back to the yard inside 14 hours and stay within 150 air miles
// Not modeled: split sleeper berth, adverse driving conditions, the 16-hour big-day exception.
(function (root) {
  "use strict";
  const H = 3600000, M = 60000;
  const STATUS = {
    off: { label: "Off duty", short: "OFF", row: 0 },
    sb:  { label: "Sleeper berth", short: "SB", row: 1 },
    d:   { label: "Driving", short: "D", row: 2 },
    on:  { label: "On duty (not driving)", short: "ON", row: 3 }
  };
  const isRest = st => st === "off" || st === "sb";
  const isWork = st => st === "d" || st === "on";

  function localDay(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayStart(day) { return new Date(day + "T00:00:00").getTime(); }
  function dayEnd(day) { const d = new Date(day + "T00:00:00"); d.setDate(d.getDate() + 1); return d.getTime(); }
  function sorted(events) {
    return (events || []).filter(e => e && e.at && STATUS[e.status]).slice().sort((a, b) => a.at.localeCompare(b.at));
  }

  // pieces of time between from and to, each with the status in force
  function segments(events, from, to) {
    const ev = sorted(events);
    const out = [];
    let cur = "off", curEv = null;
    for (const e of ev) {
      const t = new Date(e.at).getTime();
      if (t <= from) { cur = e.status; curEv = e; continue; }
      if (t >= to) break;
      const s = out.length ? out[out.length - 1].e : from;
      if (t > s) out.push({ s: s, e: t, st: cur, ev: curEv });
      cur = e.status; curEv = e;
    }
    const s = out.length ? out[out.length - 1].e : from;
    if (to > s) out.push({ s: s, e: to, st: cur, ev: curEv });
    return out;
  }

  // walk the last ~10 days and work out clocks and violations
  // opts: { modeFor(day) -> "short" | "full", cycle: "70" | "60" }
  function evaluate(events, now, opts) {
    opts = opts || {};
    now = now || Date.now();
    const modeFor = opts.modeFor || (() => "full");
    const cycleH = opts.cycle === "60" ? 60 : 70, cycleD = opts.cycle === "60" ? 7 : 8;
    const from = now - 10 * 24 * H;
    const segs = segments(events, from, now);
    const violations = [];
    let shiftStart = null, newShift = true, drive = 0, sinceBreak = 0, restRun = 0, nonDrive = 0;
    const flagged = {};
    function flag(kind, at, text) {
      const key = kind + "@" + shiftStart;
      if (flagged[key]) return;
      flagged[key] = 1;
      violations.push({ kind: kind, at: new Date(at).toISOString(), day: localDay(new Date(at)), text: text });
    }
    for (const g of segs) {
      const dur = g.e - g.s;
      if (isRest(g.st)) {
        restRun += dur; nonDrive += dur;
        if (restRun >= 10 * H) newShift = true;
        continue;
      }
      if (newShift || shiftStart === null) { shiftStart = g.s; drive = 0; sinceBreak = 0; newShift = false; }
      restRun = 0;
      if (g.st === "on") { nonDrive += dur; continue; }
      // driving
      if (nonDrive >= 30 * M) sinceBreak = 0;
      nonDrive = 0;
      const day = localDay(new Date(g.s));
      const winEnd = shiftStart + 14 * H;
      if (g.e > winEnd) flag("14", Math.max(g.s, winEnd), "Drove after the 14-hour window closed");
      if (drive + dur > 11 * H) flag("11", g.s + Math.max(0, 11 * H - drive), "Over 11 hours of driving");
      if (modeFor(day) !== "short" && sinceBreak + dur > 8 * H) flag("30", g.s + Math.max(0, 8 * H - sinceBreak), "Drove more than 8 hours without a 30-minute break");
      drive += dur; sinceBreak += dur;
    }
    const cur = segs.length ? segs[segs.length - 1].st : "off";
    const fresh = newShift || shiftStart === null;
    const clocks = {
      status: cur,
      resting: isRest(cur),
      restRun: isRest(cur) ? restRun : 0,
      shiftStart: fresh ? null : new Date(shiftStart).toISOString(),
      driveLeft: fresh ? 11 * H : 11 * H - drive,
      windowLeft: fresh ? 14 * H : shiftStart + 14 * H - now,
      breakLeft: fresh || nonDrive >= 30 * M ? 8 * H : 8 * H - sinceBreak,
      windowEnds: fresh ? null : new Date(shiftStart + 14 * H).toISOString()
    };
    // cycle: on-duty time over the last 7/8 days, reset by 34 hours in a row off
    let countFrom = now - cycleD * 24 * H, run = 0, runStart = 0;
    for (const g of segs) {
      if (isRest(g.st)) { if (!run) runStart = g.s; run += g.e - g.s; if (run >= 34 * H) countFrom = Math.max(countFrom, g.e); }
      else run = 0;
    }
    let worked = 0;
    for (const g of segs) if (isWork(g.st)) worked += Math.max(0, Math.min(g.e, now) - Math.max(g.s, countFrom));
    clocks.cycleUsed = worked;
    clocks.cycleLeft = cycleH * H - worked;
    clocks.cycleHrs = cycleH; clocks.cycleDays = cycleD;
    clocks.restartIn = isRest(cur) && run < 34 * H ? 34 * H - run : 0;
    if (clocks.cycleLeft < 0) {
      const at = now;
      violations.push({ kind: "cycle", at: new Date(at).toISOString(), day: localDay(new Date(at)), text: "Over " + cycleH + " hours in " + cycleD + " days" });
    }
    return { clocks: clocks, violations: violations };
  }

  // time in each status during one calendar day (stops at "now" for today)
  function dayTotals(events, day, now) {
    now = now || Date.now();
    const a = dayStart(day), b = Math.min(dayEnd(day), now);
    const t = { off: 0, sb: 0, d: 0, on: 0 };
    if (b <= a) return t;
    segments(events, a, b).forEach(g => { t[g.st] += g.e - g.s; });
    return t;
  }
  // first time on duty and last time off duty in a day (short-haul time record)
  function dayShift(events, day, now) {
    now = now || Date.now();
    const a = dayStart(day), b = Math.min(dayEnd(day), now);
    if (b <= a) return null;
    const work = segments(events, a, b).filter(g => isWork(g.st));
    if (!work.length) return null;
    const last = work[work.length - 1];
    return { start: work[0].s, end: last.e, open: last.e >= b && b === now, onDuty: work.reduce((s, g) => s + g.e - g.s, 0) };
  }
  function eventsOn(events, day) {
    const a = dayStart(day), b = dayEnd(day);
    return sorted(events).filter(e => { const t = new Date(e.at).getTime(); return t >= a && t < b; });
  }

  // ---------- 24-hour paper-log grid ----------
  function gridSvg(events, day, now, opts) {
    opts = opts || {};
    now = now || Date.now();
    const ink = opts.ink || "#231f1a", rule = opts.rule || "#b9ac93", line = opts.line || "#ff6a13", bad = opts.bad || "#c1443c";
    const L = 40, W = 480, R = 62, top = 20, rowH = 32;
    const a = dayStart(day), end = dayEnd(day), b = Math.min(end, now);
    const x = t => L + (t - a) / (end - a) * W;
    const y = st => top + STATUS[st].row * rowH + rowH / 2;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (L + W + R) + ' ' + (top + 4 * rowH + 4) + '" class="log-grid" role="img" aria-label="Duty status grid for ' + day + '">';
    s += '<g font-family="Helvetica,Arial,sans-serif" font-size="14" fill="' + ink + '">';
    for (let h = 0; h <= 24; h += 3) {
      const lbl = h === 0 || h === 24 ? "M" : h === 12 ? "N" : String(h % 12);
      s += '<text x="' + (L + h * 20) + '" y="14" text-anchor="middle" font-weight="700">' + lbl + '</text>';
    }
    ["OFF", "SB", "D", "ON"].forEach((t, i) => { s += '<text x="2" y="' + (top + i * rowH + rowH / 2 + 5) + '" font-weight="900" font-size="13">' + t + '</text>'; });
    s += '</g><g stroke="' + rule + '" stroke-width="0.6">';
    for (let i = 0; i <= 4; i++) s += '<line x1="' + L + '" x2="' + (L + W) + '" y1="' + (top + i * rowH) + '" y2="' + (top + i * rowH) + '"/>';
    for (let h = 0; h <= 24; h++) {
      s += '<line x1="' + (L + h * 20) + '" x2="' + (L + h * 20) + '" y1="' + top + '" y2="' + (top + 4 * rowH) + '"' + (h % 6 ? '' : ' stroke-width="1.2"') + '/>';
      if (h < 24) for (let q = 1; q < 4; q++) {
        const qx = L + h * 20 + q * 5, len = q === 2 ? 7 : 4;
        for (let r = 0; r < 4; r++) s += '<line x1="' + qx + '" x2="' + qx + '" y1="' + (top + r * rowH) + '" y2="' + (top + r * rowH + len) + '"/>';
      }
    }
    s += '</g>';
    if (b > a) {
      const segs = segments(events, a, b);
      let path = "";
      segs.forEach((g, i) => {
        if (i === 0) path += "M" + x(g.s).toFixed(1) + " " + y(g.st);
        else path += "L" + x(g.s).toFixed(1) + " " + y(g.st);
        path += "L" + x(g.e).toFixed(1) + " " + y(g.st);
      });
      s += '<path d="' + path + '" fill="none" stroke="' + line + '" stroke-width="3.5" stroke-linejoin="round"/>';
      (opts.violations || []).filter(v => v.day === day).forEach(v => {
        const t = new Date(v.at).getTime();
        s += '<circle cx="' + x(t).toFixed(1) + '" cy="' + y("d") + '" r="5" fill="' + bad + '"><title>' + v.text + '</title></circle>';
      });
      if (b < end) s += '<line x1="' + x(b).toFixed(1) + '" x2="' + x(b).toFixed(1) + '" y1="' + (top - 2) + '" y2="' + (top + 4 * rowH) + '" stroke="' + ink + '" stroke-dasharray="2 2"/>';
    }
    const tot = dayTotals(events, day, now);
    s += '<g font-family="Menlo,Courier New,monospace" font-size="15" font-weight="700" fill="' + ink + '">';
    ["off", "sb", "d", "on"].forEach(st => { s += '<text x="' + (L + W + R - 4) + '" y="' + (y(st) + 5) + '" text-anchor="end">' + hm(tot[st]) + '</text>'; });
    s += '</g></svg>';
    return s;
  }

  function hm(ms) {
    const neg = ms < 0; ms = Math.abs(ms);
    const m = Math.round(ms / M), h = Math.floor(m / 60);
    return (neg ? "-" : "") + h + ":" + String(m % 60).padStart(2, "0");
  }
  function hrs(ms) { return Math.round(ms / H * 100) / 100; }

  // ---------- where am I (offline) ----------
  // towns around Columbus, NE and common haul destinations; "≈ 4 mi NE of Columbus, NE"
  const PLACES = [
    ["Columbus, NE", 41.4297, -97.3684], ["Schuyler, NE", 41.4472, -97.0598], ["Fremont, NE", 41.4333, -96.4981], ["Norfolk, NE", 42.0328, -97.4170],
    ["Grand Island, NE", 40.9264, -98.3420], ["Kearney, NE", 40.6993, -99.0832], ["Lincoln, NE", 40.8136, -96.7026], ["Omaha, NE", 41.2565, -95.9345],
    ["York, NE", 40.8681, -97.5920], ["Seward, NE", 40.9069, -97.0989], ["David City, NE", 41.2528, -97.1300], ["Albion, NE", 41.6900, -98.0037],
    ["Genoa, NE", 41.4489, -97.7317], ["Fullerton, NE", 41.3634, -97.9695], ["Central City, NE", 41.1158, -98.0017], ["Osceola, NE", 41.1797, -97.5470],
    ["Humphrey, NE", 41.6922, -97.4842], ["Madison, NE", 41.8283, -97.4553], ["Platte Center, NE", 41.5389, -97.4895], ["Monroe, NE", 41.4747, -97.6006],
    ["Silver Creek, NE", 41.3164, -97.6631], ["Duncan, NE", 41.3889, -97.4931], ["Richland, NE", 41.4361, -97.2142], ["Leigh, NE", 41.7014, -97.2420],
    ["Clarkson, NE", 41.7253, -97.1220], ["Wahoo, NE", 41.2114, -96.6203], ["West Point, NE", 41.8417, -96.7086], ["Wayne, NE", 42.2306, -97.0178],
    ["Hastings, NE", 40.5861, -98.3887], ["Aurora, NE", 40.8672, -98.0040], ["St. Paul, NE", 41.2147, -98.4581], ["Battle Creek, NE", 41.9997, -97.5984],
    ["Newman Grove, NE", 41.7464, -97.7759], ["Shelby, NE", 41.1936, -97.4253], ["Rising City, NE", 41.1983, -97.2953], ["Bellwood, NE", 41.3428, -97.2389],
    ["Lexington, NE", 40.7808, -99.7415], ["North Platte, NE", 41.1239, -100.7654], ["Dakota City, NE", 42.4153, -96.4181], ["Sioux City, IA", 42.4999, -96.4003],
    ["Council Bluffs, IA", 41.2619, -95.8608], ["Sioux Falls, SD", 43.5446, -96.7311], ["Des Moines, IA", 41.5868, -93.6250], ["Kansas City, MO", 39.0997, -94.5786],
    ["Denver, CO", 39.7392, -104.9903], ["O'Neill, NE", 42.4578, -98.6476], ["Beatrice, NE", 40.2681, -96.7470], ["Nebraska City, NE", 40.6767, -95.8592],
    ["Broken Bow, NE", 41.4019, -99.6393], ["Ord, NE", 41.6033, -98.9262], ["Neligh, NE", 42.1286, -98.0298], ["Crete, NE", 40.6278, -96.9614]
  ];
  function airMiles(a, b) {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) / 1.15078;   // nautical (air) miles
  }
  function statuteMiles(a, b) { return airMiles(a, b) * 1.15078; }
  function nearestPlace(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng) || (!lat && !lng)) return "";
    const p = { lat: lat, lng: lng };
    let best = null;
    PLACES.forEach(t => { const d = statuteMiles(p, { lat: t[1], lng: t[2] }); if (!best || d < best.d) best = { d: d, t: t }; });
    if (!best || best.d > 40) return "";
    if (best.d < 1.5) return best.t[0];
    const dy = lat - best.t[1], dx = (lng - best.t[2]) * Math.cos(lat * Math.PI / 180);
    const dir = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    return Math.round(best.d) + " mi " + dir + " of " + best.t[0];
  }

  // ---------- inspection checklist (49 CFR 396.11 items plus common pre-trip checks) ----------
  const DVIR_ITEMS = {
    truck: [
      ["brakes", "Service brakes"], ["parking", "Parking brake"], ["air", "Air lines, leaks, compressor"], ["steering", "Steering"],
      ["lights", "Lights & reflectors"], ["tires", "Tires"], ["wheels", "Wheels, rims, lug nuts"], ["horn", "Horn"],
      ["wipers", "Wipers & washers"], ["mirrors", "Mirrors & glass"], ["coupling", "Fifth wheel / pintle hook"], ["fluids", "Oil, coolant, leaks"],
      ["gauges", "Gauges & warning lights"], ["belts", "Belts & hoses"], ["exhaust", "Exhaust"], ["body", "Frame, body, dump box"],
      ["emergency", "Triangles, extinguisher, fuses"], ["seatbelt", "Seat belt"]
    ],
    trailer: [
      ["t_brakes", "Trailer brakes"], ["t_lines", "Air & electric lines"], ["t_lights", "Lights & reflectors"], ["t_tires", "Tires"],
      ["t_wheels", "Wheels & rims"], ["t_coupling", "Hitch, drawbar, safety chains"], ["t_body", "Body, gate, doors"], ["t_landing", "Landing gear / dolly"]
    ]
  };

  root.HOS = { STATUS, isRest, isWork, localDay, dayStart, dayEnd, sorted, segments, evaluate, dayTotals, dayShift, eventsOn, gridSvg,
    hm, hrs, airMiles, statuteMiles, nearestPlace, DVIR_ITEMS, PLACES };
})(typeof window !== "undefined" ? window : globalThis);
