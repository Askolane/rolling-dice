(() => {
  "use strict";

  const DIRS = {
    up: { dx: 0, dy: -1, opposite: "down", arrow: "↑" },
    right: { dx: 1, dy: 0, opposite: "left", arrow: "→" },
    down: { dx: 0, dy: 1, opposite: "up", arrow: "↓" },
    left: { dx: -1, dy: 0, opposite: "right", arrow: "←" },
  };
  const DIR_ORDER = ["up", "right", "down", "left"];
  const BASE_DICE = { top: 1, bottom: 6, north: 2, south: 5, east: 3, west: 4 };
  const OPPOSITE_FACE = { 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1 };
  const STORAGE_KEY = "dice-drift-levels-v1";
  const WAIT = 155;

  const $ = (selector) => document.querySelector(selector);
  const board = $("#board");
  const boardWrap = $("#boardWrap");
  const toast = $("#toast");
  const dicePreview = $("#dicePreview");
  const levelSelect = $("#levelSelect");
  const editorPanel = $("#editorPanel");
  const moveCount = $("#moveCount");
  const topFace = $("#topFace");

  const app = {
    mode: "play",
    levels: [],
    customLevels: [],
    levelIndex: 0,
    currentLevel: null,
    editorLevel: null,
    editor: { tool: "path", dir: "up" },
    state: null,
    moving: false,
    pointerStart: null,
  };

  function key(x, y) {
    return `${x},${y}`;
  }

  function parseKey(value) {
    const [x, y] = value.split(",").map(Number);
    return { x, y };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneDice(dice) {
    return { ...dice };
  }

  function add(pos, dir) {
    const d = DIRS[dir];
    return { x: pos.x + d.dx, y: pos.y + d.dy };
  }

  function wallKey(x, y, dir) {
    if (dir === "left") return `${x - 1},${y},right`;
    if (dir === "up") return `${x},${y - 1},down`;
    return `${x},${y},${dir}`;
  }

  function parseWallKey(value) {
    const [x, y, dir] = value.split(",");
    return { x: Number(x), y: Number(y), dir };
  }

  function setWall(level, x, y, dir, enabled = true) {
    const id = wallKey(x, y, dir);
    if (enabled) level.walls[id] = true;
    else delete level.walls[id];
  }

  function toggleWall(level, x, y, dir) {
    const id = wallKey(x, y, dir);
    if (level.walls[id]) delete level.walls[id];
    else level.walls[id] = true;
  }

  function hasWall(level, pos, dir) {
    return Boolean(level.walls?.[wallKey(pos.x, pos.y, dir)]);
  }

  function rollDice(dice, dir) {
    const d = dice;
    if (dir === "up") {
      return { top: d.south, bottom: d.north, north: d.top, south: d.bottom, east: d.east, west: d.west };
    }
    if (dir === "down") {
      return { top: d.north, bottom: d.south, north: d.bottom, south: d.top, east: d.east, west: d.west };
    }
    if (dir === "right") {
      return { top: d.west, bottom: d.east, north: d.north, south: d.south, east: d.top, west: d.bottom };
    }
    return { top: d.east, bottom: d.west, north: d.north, south: d.south, east: d.bottom, west: d.top };
  }

  function allDiceOrientations() {
    const queue = [cloneDice(BASE_DICE)];
    const seen = new Map();
    while (queue.length) {
      const dice = queue.shift();
      const id = `${dice.top},${dice.bottom},${dice.north},${dice.south},${dice.east},${dice.west}`;
      if (seen.has(id)) continue;
      seen.set(id, dice);
      for (const dir of DIR_ORDER) queue.push(rollDice(dice, dir));
    }
    return [...seen.values()];
  }

  const DICE_ORIENTATIONS = allDiceOrientations();

  function diceFromFaces(top, north) {
    const nextTop = Number(top) || BASE_DICE.top;
    const fallbackNorth = DICE_ORIENTATIONS.find((dice) => dice.top === nextTop)?.north || BASE_DICE.north;
    const nextNorth = Number(north) || fallbackNorth;
    return cloneDice(
      DICE_ORIENTATIONS.find((dice) => dice.top === nextTop && dice.north === nextNorth) ||
        DICE_ORIENTATIONS.find((dice) => dice.top === nextTop) ||
        BASE_DICE,
    );
  }

  function sanitizeDice(dice) {
    return diceFromFaces(dice?.top, dice?.north);
  }

  function validNorthFaces(top) {
    const value = Number(top);
    return [1, 2, 3, 4, 5, 6].filter((face) => face !== value && face !== OPPOSITE_FACE[value]);
  }

  function normalizeLevel(level) {
    const next = clone(level);
    next.cells ||= {};
    next.walls ||= {};
    next.dice = sanitizeDice(next.dice || BASE_DICE);
    next.width = Math.max(4, Number(next.width) || 7);
    next.height = Math.max(4, Number(next.height) || 7);

    for (const id of Object.keys(next.cells)) {
      const { x, y } = parseKey(id);
      if (x < 0 || y < 0 || x >= next.width || y >= next.height) delete next.cells[id];
    }

    for (const [id, cell] of Object.entries(next.cells)) {
      const pos = parseKey(id);
      if (cell.type === "start") next.start = pos;
      if (cell.type === "goal") next.goal = pos;
      if (cell.type === "water" && !cell.dir) cell.dir = "right";
    }

    if (!next.start) {
      const first = Object.entries(next.cells).find(([, cell]) => cell.type !== "goal");
      next.start = first ? parseKey(first[0]) : { x: 0, y: 0 };
      next.cells[key(next.start.x, next.start.y)] = { type: "start" };
    }
    if (!next.goal) {
      const last = Object.entries(next.cells).find(([id]) => id !== key(next.start.x, next.start.y));
      next.goal = last ? parseKey(last[0]) : { x: Math.min(1, next.width - 1), y: 0 };
      next.cells[key(next.goal.x, next.goal.y)] = { type: "goal" };
    }

    for (const [id, cell] of Object.entries(next.cells)) {
      const pos = parseKey(id);
      if (pos.x === next.start.x && pos.y === next.start.y) cell.type = "start";
      else if (cell.type === "start") cell.type = "path";
      if (pos.x === next.goal.x && pos.y === next.goal.y) cell.type = "goal";
      else if (cell.type === "goal") cell.type = "path";
    }

    const cleanWalls = {};
    for (const id of Object.keys(next.walls)) {
      const wall = parseWallKey(id);
      if ((wall.dir === "right" || wall.dir === "down") && wall.x >= -1 && wall.y >= -1 && wall.x <= next.width && wall.y <= next.height) {
        cleanWalls[wallKey(wall.x, wall.y, wall.dir)] = true;
      }
    }
    next.walls = cleanWalls;
    return next;
  }

  function shiftAndFit(level, padding = 1) {
    const points = Object.keys(level.cells).map(parseKey);
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    const sx = -minX + padding;
    const sy = -minY + padding;
    const cells = {};
    for (const [id, cell] of Object.entries(level.cells)) {
      const p = parseKey(id);
      cells[key(p.x + sx, p.y + sy)] = clone(cell);
    }
    const walls = {};
    for (const id of Object.keys(level.walls || {})) {
      const wall = parseWallKey(id);
      walls[wallKey(wall.x + sx, wall.y + sy, wall.dir)] = true;
    }
    return normalizeLevel({
      ...level,
      width: maxX - minX + 1 + padding * 2,
      height: maxY - minY + 1 + padding * 2,
      start: { x: level.start.x + sx, y: level.start.y + sy },
      goal: { x: level.goal.x + sx, y: level.goal.y + sy },
      cells,
      walls,
    });
  }

  function setCell(level, x, y, type = "path", dir = "right") {
    if (x < 0 || y < 0 || x >= level.width || y >= level.height) return;
    const id = key(x, y);
    if (type === "void") {
      delete level.cells[id];
      if (level.start?.x === x && level.start?.y === y) level.start = null;
      if (level.goal?.x === x && level.goal?.y === y) level.goal = null;
      return;
    }
    if (type === "start") {
      if (level.start) {
        const old = key(level.start.x, level.start.y);
        if (level.cells[old]?.type === "start") level.cells[old] = { type: "path" };
      }
      level.start = { x, y };
      level.cells[id] = { type: "start" };
      return;
    }
    if (type === "goal") {
      if (level.goal) {
        const old = key(level.goal.x, level.goal.y);
        if (level.cells[old]?.type === "goal") level.cells[old] = { type: "path" };
      }
      level.goal = { x, y };
      level.cells[id] = { type: "goal" };
      return;
    }
    level.cells[id] = type === "water" ? { type, dir } : { type };
  }

  function resizeLevel(level, width, height) {
    level.width = Math.max(4, Math.min(12, Number(width) || level.width));
    level.height = Math.max(4, Math.min(12, Number(height) || level.height));
    for (const id of Object.keys(level.cells)) {
      const p = parseKey(id);
      if (p.x >= level.width || p.y >= level.height) delete level.cells[id];
    }
    if (!level.cells[key(level.start?.x, level.start?.y)]) level.start = null;
    if (!level.cells[key(level.goal?.x, level.goal?.y)]) level.goal = null;
    app.editorLevel = normalizeLevel(level);
  }

  function moveState(level, source, dir) {
    const state = { pos: { ...source.pos }, dice: cloneDice(source.dice) };
    const steps = state.dice.top;
    let fell = false;
    let fallPos = null;

    for (let i = 0; i < steps; i += 1) {
      if (hasWall(level, state.pos, dir)) break;
      const nextPos = add(state.pos, dir);
      state.dice = rollDice(state.dice, dir);
      if (!level.cells[key(nextPos.x, nextPos.y)]) {
        state.pos = nextPos;
        fell = true;
        fallPos = nextPos;
        break;
      }
      state.pos = nextPos;
      if (level.cells[key(state.pos.x, state.pos.y)]?.type === "sticky") break;
    }

    if (fell) return { kind: "loss", state, fallPos };

    const slid = slideWater(level, state.pos);
    state.pos = slid.pos;

    if (state.pos.x === level.goal.x && state.pos.y === level.goal.y) {
      return { kind: "win", state };
    }
    return { kind: "ok", state };
  }

  function slideWater(level, start) {
    let pos = { ...start };
    const seen = new Set();
    for (let i = 0; i < 64; i += 1) {
      const cell = level.cells[key(pos.x, pos.y)];
      if (!cell || cell.type !== "water") break;
      const id = key(pos.x, pos.y);
      if (seen.has(id)) break;
      seen.add(id);
      const dir = cell.dir || "right";
      if (hasWall(level, pos, dir)) break;
      const next = add(pos, dir);
      const nextCell = level.cells[key(next.x, next.y)];
      if (!nextCell || nextCell.type !== "water") break;
      pos = next;
    }
    return { pos };
  }

  function stateKey(state) {
    const d = state.dice;
    return `${state.pos.x},${state.pos.y}|${d.top},${d.bottom},${d.north},${d.south},${d.east},${d.west}`;
  }

  function solveLevel(level, maxDepth = 70) {
    const root = { pos: { ...level.start }, dice: cloneDice(level.dice || BASE_DICE) };
    const queue = [{ state: root, path: [] }];
    const seen = new Set([stateKey(root)]);

    while (queue.length) {
      const item = queue.shift();
      if (item.path.length >= maxDepth) continue;
      for (const dir of DIR_ORDER) {
        const result = moveState(level, item.state, dir);
        if (result.kind === "loss") continue;
        const nextPath = [...item.path, dir];
        if (result.kind === "win") return nextPath;
        const id = stateKey(result.state);
        if (!seen.has(id)) {
          seen.add(id);
          queue.push({ state: result.state, path: nextPath });
        }
      }
    }
    return null;
  }

  function recipeLevel(options) {
    const level = {
      id: options.id,
      name: options.name,
      width: 1,
      height: 1,
      dice: cloneDice(options.dice || BASE_DICE),
      start: { x: 0, y: 0 },
      goal: { x: 0, y: 0 },
      cells: { [key(0, 0)]: { type: "start" } },
      walls: {},
    };
    let pos = { x: 0, y: 0 };
    let dice = cloneDice(level.dice);

    for (const segment of options.segments) {
      const len = segment.len ?? dice.top;
      for (let i = 0; i < len; i += 1) {
        pos = add(pos, segment.dir);
        dice = rollDice(dice, segment.dir);
        if (!level.cells[key(pos.x, pos.y)]) level.cells[key(pos.x, pos.y)] = { type: "path" };
      }
      if (segment.stop === "sticky") level.cells[key(pos.x, pos.y)] = { type: "sticky" };
      if (segment.stop === "wall") setWall(level, pos.x, pos.y, segment.dir, true);
      if (segment.water) {
        level.cells[key(pos.x, pos.y)] = { type: "water", dir: segment.water.dir };
        for (let i = 0; i < segment.water.len; i += 1) {
          pos = add(pos, segment.water.dir);
          level.cells[key(pos.x, pos.y)] = { type: "water", dir: segment.water.dir };
        }
      }
    }

    level.goal = { ...pos };
    level.cells[key(level.start.x, level.start.y)] = { type: "start" };
    level.cells[key(level.goal.x, level.goal.y)] = { type: "goal" };

    for (const decoy of options.decoys || []) {
      level.cells[key(decoy.x, decoy.y)] = decoy.type === "water" ? { type: "water", dir: decoy.dir || "right" } : { type: decoy.type || "path" };
    }
    for (const wall of options.walls || []) setWall(level, wall.x, wall.y, wall.dir, true);

    const fitted = shiftAndFit(level, 1);
    addDecoys(fitted, options.randomDecoys || 0, hashString(options.id), options.mechanicDecoys || false);
    fitted.solution = solveLevel(fitted, 80) || [];
    return fitted;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function rng(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sample(list, random) {
    return list[Math.floor(random() * list.length)];
  }

  function shuffle(list, random) {
    const next = [...list];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  function addDecoys(level, count, seed, mechanics = false) {
    const random = rng(seed);
    for (let i = 0; i < count; i += 1) {
      const points = Object.keys(level.cells).map(parseKey);
      const base = sample(points, random);
      const dir = sample(DIR_ORDER, random);
      const p = add(base, dir);
      if (p.x < 0 || p.y < 0 || p.x >= level.width || p.y >= level.height) continue;
      const id = key(p.x, p.y);
      if (level.cells[id]) continue;
      const roll = random();
      if (mechanics && roll < 0.12) level.cells[id] = { type: "sticky" };
      else if (mechanics && roll < 0.22) level.cells[id] = { type: "water", dir: sample(DIR_ORDER, random) };
      else level.cells[id] = { type: "path" };
    }
  }

  function makeDefaultLevels() {
    return [
      recipeLevel({
        id: "l01",
        name: "1. 첫 굴림",
        segments: [{ dir: "right" }],
      }),
      recipeLevel({
        id: "l02",
        name: "2. 네 칸의 숨",
        segments: [{ dir: "right" }, { dir: "down" }],
        randomDecoys: 1,
      }),
      recipeLevel({
        id: "l03",
        name: "3. 빈틈 둘레",
        segments: [{ dir: "right" }, { dir: "down" }, { dir: "left" }, { dir: "up" }],
        randomDecoys: 3,
      }),
      recipeLevel({
        id: "l04",
        name: "4. 끈끈한 중지",
        segments: [{ dir: "right" }, { dir: "down", len: 2, stop: "sticky" }, { dir: "right" }],
        randomDecoys: 3,
      }),
      recipeLevel({
        id: "l05",
        name: "5. 벽의 반동",
        segments: [{ dir: "right" }, { dir: "down", len: 2, stop: "wall" }, { dir: "right" }, { dir: "up" }],
        randomDecoys: 4,
      }),
      recipeLevel({
        id: "l06",
        name: "6. 흐르는 칸",
        segments: [{ dir: "right" }, { dir: "down", water: { dir: "right", len: 2 } }, { dir: "up" }],
        randomDecoys: 5,
      }),
      recipeLevel({
        id: "l07",
        name: "7. 미끄러운 틈",
        segments: [
          { dir: "right" },
          { dir: "down", len: 2, stop: "sticky" },
          { dir: "right" },
          { dir: "down", water: { dir: "left", len: 2 } },
          { dir: "up" },
        ],
        randomDecoys: 6,
        mechanicDecoys: true,
      }),
      recipeLevel({
        id: "l08",
        name: "8. 긴 되돌림",
        segments: [
          { dir: "right" },
          { dir: "down", len: 2, stop: "sticky" },
          { dir: "right" },
          { dir: "down" },
          { dir: "left", len: 3, stop: "sticky" },
          { dir: "down" },
          { dir: "right" },
          { dir: "up" },
        ],
        randomDecoys: 8,
        mechanicDecoys: true,
      }),
      recipeLevel({
        id: "l09",
        name: "9. 벽과 물길",
        segments: [
          { dir: "right" },
          { dir: "down", len: 2, stop: "wall" },
          { dir: "right" },
          { dir: "down" },
          { dir: "left", len: 3, stop: "sticky" },
          { dir: "down", water: { dir: "right", len: 2 } },
          { dir: "up" },
        ],
        randomDecoys: 9,
        mechanicDecoys: true,
      }),
      recipeLevel({
        id: "l10",
        name: "10. 목적지의 가장자리",
        segments: [
          { dir: "right" },
          { dir: "down", len: 2, stop: "sticky" },
          { dir: "right" },
          { dir: "down" },
          { dir: "left", len: 3, stop: "wall" },
          { dir: "down" },
          { dir: "right" },
          { dir: "up" },
          { dir: "right", len: 2, stop: "sticky" },
          { dir: "down" },
          { dir: "left" },
        ],
        randomDecoys: 0,
        mechanicDecoys: true,
      }),
    ];
  }

  function generateLevel(difficulty = 3) {
    const diff = Math.max(1, Math.min(5, Number(difficulty) || 3));
    const random = rng(Date.now() + diff * 7919);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const level = {
        id: `gen-${Date.now()}-${attempt}`,
        name: `생성 레벨 ${diff}`,
        width: 1,
        height: 1,
        dice: cloneDice(BASE_DICE),
        start: { x: 0, y: 0 },
        goal: { x: 0, y: 0 },
        cells: { [key(0, 0)]: { type: "start" } },
        walls: {},
      };
      let pos = { x: 0, y: 0 };
      let dice = cloneDice(BASE_DICE);
      const used = new Set([key(0, 0)]);
      const turns = 3 + diff * 2 + Math.floor(random() * (diff + 1));
      let failed = false;

      for (let turn = 0; turn < turns; turn += 1) {
        const candidates = shuffle(DIR_ORDER, random);
        let picked = null;
        for (const dir of candidates) {
          const top = dice.top;
          let len = top;
          let stop = null;
          const mechanicRoll = random();
          if (turn > 0 && top > 1 && diff >= 2 && mechanicRoll < 0.38 + diff * 0.08) {
            len = 1 + Math.floor(random() * (top - 1));
            stop = random() < 0.55 ? "sticky" : "wall";
          }
          const trial = simulateSegment(pos, dice, dir, len, used);
          if (!trial) continue;
          picked = { dir, len, stop, ...trial };
          break;
        }
        if (!picked) {
          failed = true;
          break;
        }
        pos = picked.pos;
        dice = picked.dice;
        for (const p of picked.path) {
          used.add(key(p.x, p.y));
          level.cells[key(p.x, p.y)] = { type: "path" };
        }
        if (picked.stop === "sticky") level.cells[key(pos.x, pos.y)] = { type: "sticky" };
        if (picked.stop === "wall") setWall(level, pos.x, pos.y, picked.dir, true);

        if (!picked.stop && diff >= 3 && random() < 0.18 + diff * 0.04) {
          const waterDir = sample(DIR_ORDER.filter((d) => d !== DIRS[picked.dir].opposite), random);
          const slideLen = 1 + Math.floor(random() * Math.min(3, diff));
          const waterPath = simulateSlide(pos, waterDir, slideLen, used);
          if (waterPath) {
            level.cells[key(pos.x, pos.y)] = { type: "water", dir: waterDir };
            for (const p of waterPath) {
              pos = p;
              used.add(key(p.x, p.y));
              level.cells[key(p.x, p.y)] = { type: "water", dir: waterDir };
            }
          }
        }
      }
      if (failed) continue;
      level.goal = { ...pos };
      level.cells[key(level.start.x, level.start.y)] = { type: "start" };
      level.cells[key(level.goal.x, level.goal.y)] = { type: "goal" };
      const fitted = shiftAndFit(level, 1);
      if (fitted.width > 12 || fitted.height > 12) continue;
      addDecoys(fitted, diff * 3 + 2, Math.floor(random() * 999999), diff >= 4);
      const solution = solveLevel(fitted, 90);
      if (solution && solution.length >= Math.max(2, diff + 1)) {
        fitted.solution = solution;
        return fitted;
      }
    }
    return recipeLevel({
      id: `gen-fallback-${Date.now()}`,
      name: `생성 레벨 ${diff}`,
      segments: [
        { dir: "right" },
        { dir: "down", len: 2, stop: diff > 2 ? "sticky" : "wall" },
        { dir: "right" },
        { dir: "down" },
        { dir: "left", len: 3, stop: "sticky" },
      ],
      randomDecoys: diff * 3,
      mechanicDecoys: diff > 3,
    });
  }

  function simulateSegment(pos, dice, dir, len, used) {
    let nextPos = { ...pos };
    let nextDice = cloneDice(dice);
    const path = [];
    for (let i = 0; i < len; i += 1) {
      nextPos = add(nextPos, dir);
      nextDice = rollDice(nextDice, dir);
      const id = key(nextPos.x, nextPos.y);
      if (used.has(id)) return null;
      path.push({ ...nextPos });
    }
    return { pos: nextPos, dice: nextDice, path };
  }

  function simulateSlide(pos, dir, len, used) {
    let nextPos = { ...pos };
    const path = [];
    for (let i = 0; i < len; i += 1) {
      nextPos = add(nextPos, dir);
      if (used.has(key(nextPos.x, nextPos.y))) return null;
      path.push({ ...nextPos });
    }
    return path;
  }

  function loadCustomLevels() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalizeLevel) : [];
    } catch {
      return [];
    }
  }

  function saveCustomLevels() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.customLevels));
  }

  function rebuildLevels() {
    app.levels = [...makeDefaultLevels(), ...app.customLevels];
    levelSelect.innerHTML = "";
    app.levels.forEach((level, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = level.name;
      levelSelect.append(option);
    });
  }

  function startLevel(index) {
    app.levelIndex = Math.max(0, Math.min(app.levels.length - 1, index));
    app.currentLevel = normalizeLevel(app.levels[app.levelIndex]);
    levelSelect.value = String(app.levelIndex);
    app.state = {
      pos: { ...app.currentLevel.start },
      dice: cloneDice(app.currentLevel.dice || BASE_DICE),
      moves: 0,
      status: "playing",
      history: [],
    };
    app.moving = false;
    render();
    hideToast();
  }

  function getRenderLevel() {
    return app.mode === "editor" ? app.editorLevel : app.currentLevel;
  }

  function cellMetrics(level) {
    const rect = board.getBoundingClientRect();
    const width = rect.width || boardWrap.clientWidth;
    const height = rect.height || boardWrap.clientHeight;
    const cell = Math.floor(Math.min((width - 24) / level.width, (height - 24) / level.height));
    const size = Math.max(28, Math.min(62, cell));
    return {
      cell: size,
      left: Math.round((width - size * level.width) / 2),
      top: Math.round((height - size * level.height) / 2),
    };
  }

  function render() {
    const level = getRenderLevel();
    if (!level) return;
    board.innerHTML = "";
    const metrics = cellMetrics(level);
    board.style.setProperty("--cell", `${metrics.cell}px`);

    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        const cell = level.cells[key(x, y)];
        if (!cell && app.mode !== "editor") continue;
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `tile ${cell ? cell.type : "ghost"}`;
        tile.style.left = `${metrics.left + x * metrics.cell}px`;
        tile.style.top = `${metrics.top + y * metrics.cell}px`;
        tile.dataset.x = String(x);
        tile.dataset.y = String(y);
        tile.tabIndex = app.mode === "editor" ? 0 : -1;
        tile.setAttribute("aria-label", `${x},${y}`);
        if (cell?.type === "water") tile.dataset.arrow = DIRS[cell.dir || "right"].arrow;
        board.append(tile);
      }
    }

    renderWalls(level, metrics);
    if (app.mode === "play") {
      renderDice(level, metrics);
      renderDicePreview(app.state.dice);
    } else {
      dicePreview.hidden = true;
    }
    updateStats();
  }

  function renderWalls(level, metrics) {
    for (const id of Object.keys(level.walls || {})) {
      const wall = parseWallKey(id);
      const el = document.createElement("div");
      const isVertical = wall.dir === "right";
      el.className = `wall ${isVertical ? "vertical" : "horizontal"}`;
      if (isVertical) {
        el.style.left = `${metrics.left + (wall.x + 1) * metrics.cell - 4}px`;
        el.style.top = `${metrics.top + wall.y * metrics.cell + 4}px`;
      } else {
        el.style.left = `${metrics.left + wall.x * metrics.cell + 4}px`;
        el.style.top = `${metrics.top + (wall.y + 1) * metrics.cell - 4}px`;
      }
      board.append(el);
    }
  }

  function renderDice(level, metrics) {
    const dice = document.createElement("div");
    dice.className = `dice ${app.state.status === "lost" ? "falling" : ""}`;
    dice.style.left = `${metrics.left + app.state.pos.x * metrics.cell + metrics.cell / 2}px`;
    dice.style.top = `${metrics.top + app.state.pos.y * metrics.cell + metrics.cell / 2}px`;
    dice.setAttribute("aria-label", `dice top ${app.state.dice.top}`);
    const visible = pipMap(app.state.dice.top);
    for (let i = 1; i <= 9; i += 1) {
      const pip = document.createElement("span");
      pip.className = "pip";
      if (!visible.includes(i)) pip.hidden = true;
      dice.append(pip);
    }
    board.append(dice);
  }

  function renderDicePreview(dice) {
    dicePreview.hidden = false;
    dicePreview.setAttribute("aria-label", `윗면 ${dice.top}, 오른쪽 면 ${dice.east}, 아래쪽 면 ${dice.south}`);

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 104 92");
    svg.setAttribute("aria-hidden", "true");

    const faces = [
      {
        name: "top",
        value: dice.top,
        points: [
          [52, 8],
          [88, 28],
          [52, 48],
          [16, 28],
        ],
      },
      {
        name: "right",
        value: dice.east,
        points: [
          [88, 28],
          [52, 48],
          [52, 86],
          [88, 66],
        ],
      },
      {
        name: "front",
        value: dice.south,
        points: [
          [16, 28],
          [52, 48],
          [52, 86],
          [16, 66],
        ],
      },
    ];

    for (const face of faces) {
      const polygon = document.createElementNS(ns, "polygon");
      polygon.setAttribute("class", `iso-face ${face.name}`);
      polygon.setAttribute("points", face.points.map((point) => point.join(",")).join(" "));
      svg.append(polygon);
    }

    for (const face of faces) {
      for (const pos of pipPositions(face.value)) {
        const point = bilerp(face.points, pos[0], pos[1]);
        const pip = document.createElementNS(ns, "circle");
        pip.setAttribute("class", "iso-pip");
        pip.setAttribute("cx", point.x.toFixed(2));
        pip.setAttribute("cy", point.y.toFixed(2));
        pip.setAttribute("r", face.name === "top" ? "2.45" : "2.35");
        svg.append(pip);
      }
    }

    dicePreview.replaceChildren(svg);
  }

  function bilerp(points, u, v) {
    const [p00, p10, p11, p01] = points;
    return {
      x: (1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + u * v * p11[0] + (1 - u) * v * p01[0],
      y: (1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + u * v * p11[1] + (1 - u) * v * p01[1],
    };
  }

  function pipPositions(value) {
    return {
      1: [[0.5, 0.5]],
      2: [
        [0.32, 0.32],
        [0.68, 0.68],
      ],
      3: [
        [0.32, 0.32],
        [0.5, 0.5],
        [0.68, 0.68],
      ],
      4: [
        [0.32, 0.32],
        [0.68, 0.32],
        [0.32, 0.68],
        [0.68, 0.68],
      ],
      5: [
        [0.32, 0.32],
        [0.68, 0.32],
        [0.5, 0.5],
        [0.32, 0.68],
        [0.68, 0.68],
      ],
      6: [
        [0.3, 0.3],
        [0.5, 0.3],
        [0.7, 0.3],
        [0.3, 0.7],
        [0.5, 0.7],
        [0.7, 0.7],
      ],
    }[value];
  }

  function pipMap(value) {
    return {
      1: [5],
      2: [1, 9],
      3: [1, 5, 9],
      4: [1, 3, 7, 9],
      5: [1, 3, 5, 7, 9],
      6: [1, 3, 4, 6, 7, 9],
    }[value];
  }

  function updateStats() {
    if (!app.state) return;
    const level = getRenderLevel();
    moveCount.textContent = `${app.state.moves}턴`;
    topFace.textContent = `윗면 ${app.state.dice.top}`;
    $("#gridWidth").value = String(level.width);
    $("#gridHeight").value = String(level.height);
    $("#editDir").value = app.editor.dir;
    $("#startTop").value = String(level.dice.top);
    refreshNorthOptions(level.dice.top, level.dice.north);
  }

  function refreshNorthOptions(top, north) {
    const select = $("#startNorth");
    const valid = validNorthFaces(top);
    const selected = valid.includes(Number(north)) ? Number(north) : valid[0];
    select.innerHTML = "";
    for (const face of valid) {
      const option = document.createElement("option");
      option.value = String(face);
      option.textContent = String(face);
      select.append(option);
    }
    select.value = String(selected);
    return selected;
  }

  function updateEditorDice() {
    const top = Number($("#startTop").value);
    const north = refreshNorthOptions(top, Number($("#startNorth").value));
    app.editorLevel.dice = diceFromFaces(top, north);
    $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
    render();
  }

  async function move(dir) {
    if (app.mode !== "play" || app.moving || app.state.status !== "playing") return;
    app.moving = true;
    app.state.history.push({ pos: { ...app.state.pos }, dice: cloneDice(app.state.dice), moves: app.state.moves, status: app.state.status });
    hideToast();

    const top = app.state.dice.top;
    let lost = false;
    for (let i = 0; i < top; i += 1) {
      if (hasWall(app.currentLevel, app.state.pos, dir)) break;
      const nextPos = add(app.state.pos, dir);
      app.state.dice = rollDice(app.state.dice, dir);
      app.state.pos = nextPos;
      if (!app.currentLevel.cells[key(nextPos.x, nextPos.y)]) {
        lost = true;
        app.state.status = "lost";
        render();
        await delay(WAIT);
        break;
      }
      render();
      await delay(WAIT);
      if (app.currentLevel.cells[key(app.state.pos.x, app.state.pos.y)]?.type === "sticky") break;
    }

    if (!lost) {
      await animateWater();
      app.state.moves += 1;
      if (app.state.pos.x === app.currentLevel.goal.x && app.state.pos.y === app.currentLevel.goal.y) {
        app.state.status = "won";
        render();
        showToast(`도착 ${app.state.moves}턴`);
      } else {
        render();
      }
    } else {
      app.state.moves += 1;
      showToast("공허로 떨어졌습니다");
    }
    app.moving = false;
  }

  async function animateWater() {
    const seen = new Set();
    for (let i = 0; i < 64; i += 1) {
      const cell = app.currentLevel.cells[key(app.state.pos.x, app.state.pos.y)];
      if (!cell || cell.type !== "water") break;
      const id = key(app.state.pos.x, app.state.pos.y);
      if (seen.has(id)) break;
      seen.add(id);
      const dir = cell.dir || "right";
      if (hasWall(app.currentLevel, app.state.pos, dir)) break;
      const next = add(app.state.pos, dir);
      const nextCell = app.currentLevel.cells[key(next.x, next.y)];
      if (!nextCell || nextCell.type !== "water") break;
      app.state.pos = next;
      render();
      await delay(WAIT * 0.82);
    }
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function resetLevel() {
    startLevel(app.levelIndex);
  }

  function undoMove() {
    if (app.mode !== "play" || app.moving || !app.state.history.length) return;
    const previous = app.state.history.pop();
    app.state.pos = previous.pos;
    app.state.dice = previous.dice;
    app.state.moves = previous.moves;
    app.state.status = "playing";
    render();
    hideToast();
  }

  function showToast(message, duration = 2200) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(hideToast, duration);
  }

  function hideToast() {
    toast.hidden = true;
  }

  function switchMode(mode) {
    app.mode = mode;
    document.body.classList.toggle("editor-mode", mode === "editor");
    editorPanel.hidden = mode !== "editor";
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
    if (mode === "editor") {
      app.editorLevel = clone(app.currentLevel);
      $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
    }
    render();
  }

  function applyEditorTool(x, y) {
    const level = app.editorLevel;
    const tool = app.editor.tool;
    if (tool === "wall") toggleWall(level, x, y, app.editor.dir);
    else setCell(level, x, y, tool, app.editor.dir);
    app.editorLevel = normalizeLevel(level);
    $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
    render();
  }

  function makeBlankLevel(width = 7, height = 7) {
    const level = {
      id: `custom-${Date.now()}`,
      name: "새 레벨",
      width,
      height,
      dice: cloneDice(BASE_DICE),
      start: { x: 1, y: 1 },
      goal: { x: width - 2, y: height - 2 },
      cells: {},
      walls: {},
    };
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) level.cells[key(x, y)] = { type: "path" };
    }
    level.cells[key(level.start.x, level.start.y)] = { type: "start" };
    level.cells[key(level.goal.x, level.goal.y)] = { type: "goal" };
    return normalizeLevel(level);
  }

  function saveEditorLevel() {
    const level = normalizeLevel(app.editorLevel);
    level.id = `custom-${Date.now()}`;
    level.name = `사용자 ${app.customLevels.length + 1}`;
    delete level.solution;
    app.customLevels.push(level);
    saveCustomLevels();
    rebuildLevels();
    startLevel(app.levels.length - 1);
    switchMode("play");
    showToast("저장 완료");
  }

  function testEditorLevel() {
    const level = normalizeLevel(app.editorLevel);
    const solution = solveLevel(level, 90);
    if (solution) showToast(`검증 통과 ${solution.length}턴`);
    else showToast("아직 경로가 없습니다");
  }

  function exportEditorLevel() {
    $("#levelJson").value = JSON.stringify(normalizeLevel(app.editorLevel), null, 2);
    showToast("내보냈습니다");
  }

  function importEditorLevel() {
    try {
      const level = normalizeLevel(JSON.parse($("#levelJson").value));
      app.editorLevel = level;
      render();
      showToast("불러왔습니다");
    } catch {
      showToast("JSON을 확인해주세요");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchMode(tab.dataset.mode));
    });
    levelSelect.addEventListener("change", () => startLevel(Number(levelSelect.value)));
    $("#prevLevel").addEventListener("click", () => startLevel(app.levelIndex - 1));
    $("#nextLevel").addEventListener("click", () => startLevel(app.levelIndex + 1));
    $("#resetLevel").addEventListener("click", resetLevel);
    $("#undoMove").addEventListener("click", undoMove);

    window.addEventListener("keydown", (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const dir = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" }[event.key];
      if (dir) {
        event.preventDefault();
        move(dir);
      }
    });

    boardWrap.addEventListener("pointerdown", (event) => {
      if (app.mode === "play") {
        app.pointerStart = { x: event.clientX, y: event.clientY };
        return;
      }
      const tile = event.target.closest(".tile");
      if (!tile) return;
      applyEditorTool(Number(tile.dataset.x), Number(tile.dataset.y));
    });

    boardWrap.addEventListener("pointerup", (event) => {
      if (app.mode !== "play" || !app.pointerStart) return;
      const dx = event.clientX - app.pointerStart.x;
      const dy = event.clientY - app.pointerStart.y;
      app.pointerStart = null;
      if (Math.hypot(dx, dy) < 28) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    });

    document.querySelectorAll(".tool").forEach((tool) => {
      tool.addEventListener("click", () => {
        app.editor.tool = tool.dataset.tool;
        document.querySelectorAll(".tool").forEach((item) => item.classList.toggle("active", item === tool));
      });
    });
    $("#editDir").addEventListener("change", (event) => {
      app.editor.dir = event.target.value;
    });
    $("#startTop").addEventListener("change", updateEditorDice);
    $("#startNorth").addEventListener("change", updateEditorDice);
    $("#gridWidth").addEventListener("change", () => {
      resizeLevel(app.editorLevel, $("#gridWidth").value, $("#gridHeight").value);
      render();
    });
    $("#gridHeight").addEventListener("change", () => {
      resizeLevel(app.editorLevel, $("#gridWidth").value, $("#gridHeight").value);
      render();
    });
    $("#newLevel").addEventListener("click", () => {
      app.editorLevel = makeBlankLevel(Number($("#gridWidth").value), Number($("#gridHeight").value));
      $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
      render();
    });
    $("#cloneLevel").addEventListener("click", () => {
      app.editorLevel = clone(app.currentLevel);
      $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
      render();
    });
    $("#saveLevel").addEventListener("click", saveEditorLevel);
    $("#testLevel").addEventListener("click", testEditorLevel);
    $("#exportLevel").addEventListener("click", exportEditorLevel);
    $("#importLevel").addEventListener("click", importEditorLevel);
    $("#generateLevel").addEventListener("click", () => {
      app.editorLevel = generateLevel($("#genDifficulty").value);
      $("#levelJson").value = JSON.stringify(app.editorLevel, null, 2);
      render();
      const solution = solveLevel(app.editorLevel, 90);
      showToast(solution ? `생성 완료 ${solution.length}턴` : "생성 완료");
    });
    window.addEventListener("resize", render);
  }

  function init() {
    app.customLevels = loadCustomLevels();
    rebuildLevels();
    bindEvents();
    startLevel(0);
  }

  window.DiceDrift = {
    generateLevel,
    makeDefaultLevels,
    moveState,
    solveLevel,
  };

  init();
})();
