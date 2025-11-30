/**
 * BACKEND ENGINE
 * Contains Physics, Compiler, and Virtual Machine.
 */

// --- MATH UTILS ---
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const vec = {
    add: (v1, v2) => ({x: v1.x+v2.x, y: v1.y+v2.y}),
    mul: (v, s) => ({x: v.x*s, y: v.y*s}),
    mag: (v) => Math.sqrt(v.x*v.x + v.y*v.y),
    dot: (v1, v2) => v1.x*v2.x + v1.y*v2.y,
    cross2d: (v1, v2) => v1.x*v2.y - v1.y*v2.x,
    norm: (v) => { 
        const m = Math.sqrt(v.x*v.x + v.y*v.y); 
        return m===0 ? {x:0,y:0} : {x:v.x/m, y:v.y/m}; 
    }
};

const PLANET = {
    radius: 600000,      // 600km
    mass: 5.2915e22,     // Kerbin
    atmHeight: 70000,
    G: 6.674e-11
};

// --- PHYSICS CLASS ---
class Physics {
    constructor() {
        this.reset({});
    }

    reset(config) {
        // Safe Defaults
        this.massDry = (config.mass || 25) * 1000;
        this.fuelStart = config.fuel || 600;
        this.thrustMax = (config.thrust || 500) * 1000;
        this.stages = config.stages !== undefined ? config.stages : 2;
        
        // State
        this.pos = { x: 0, y: PLANET.radius }; 
        this.vel = { x: 0, y: 0 }; 
        this.angle = 90; 
        this.fuel = this.fuelStart;
        this.throttle = 0;
        this.steeringTarget = 90;
        this.crashed = false;
        this.landed = true;
        this.trail = [];
    }

    step(dt) {
        if (this.crashed) return;

        const dist = vec.mag(this.pos);
        const alt = dist - PLANET.radius;
        const upVec = vec.norm(this.pos);

        // 1. Steering
        let err = this.steeringTarget - this.angle;
        while (err > 180) err -= 360;
        while (err < -180) err += 360;
        const turnRate = 50 * dt; 
        if (Math.abs(err) < turnRate) this.angle = this.steeringTarget;
        else this.angle += Math.sign(err) * turnRate;

        // 2. Forces
        let acc = {x:0, y:0};

        // Gravity
        const gMag = (PLANET.G * PLANET.mass) / (dist * dist);
        acc = vec.add(acc, vec.mul(upVec, -gMag));

        // Thrust
        let currentMass = this.massDry + (this.fuel * 5); // 5kg per unit
        if (currentMass <= 0) currentMass = 1000;

        if (this.fuel > 0 && this.throttle > 0) {
            const consumption = this.throttle * 2.0 * dt;
            if (this.fuel >= consumption) {
                this.fuel -= consumption;
                const rad = this.angle * DEG2RAD;
                const tVec = { 
                    x: Math.cos(rad) * this.throttle * this.thrustMax, 
                    y: Math.sin(rad) * this.throttle * this.thrustMax 
                };
                acc = vec.add(acc, vec.mul(tVec, 1/currentMass));
            } else {
                this.fuel = 0;
            }
        }

        // Drag
        if (alt < PLANET.atmHeight && alt > 0) {
            const density = 1.2 * Math.exp(-alt / 5000);
            const vMag = vec.mag(this.vel);
            if (vMag > 0) {
                const dragMag = 0.5 * density * vMag * vMag * 0.008;
                const dragVec = vec.mul(vec.norm(this.vel), -dragMag / currentMass);
                acc = vec.add(acc, dragVec);
            }
        }

        // Integration
        if (!this.landed || this.throttle > 0) {
            this.landed = false;
            this.vel = vec.add(this.vel, vec.mul(acc, dt));
            this.pos = vec.add(this.pos, vec.mul(this.vel, dt));
        }

        // Collision
        if (dist < PLANET.radius) {
            if (vec.mag(this.vel) > 10) this.crashed = true;
            this.pos = vec.mul(vec.norm(this.pos), PLANET.radius);
            this.vel = {x:0, y:0};
            this.landed = true;
        }

        // Trail Buffer
        if (Math.random() < 0.1) {
            this.trail.push({...this.pos});
            if (this.trail.length > 500) this.trail.shift();
        }
    }

    getOrbit() {
        const r = vec.mag(this.pos);
        const v = vec.mag(this.vel);
        const mu = PLANET.G * PLANET.mass;
        const E = (v*v)/2 - mu/r;
        
        let a = -mu / (2*E);
        
        if (Math.abs(E) < 0.001) a = 9999999999; 

        const h = Math.abs(vec.cross2d(this.pos, this.vel));
        const term = (2 * E * h * h) / (mu * mu);
        const e = Math.sqrt(Math.max(0, 1 + term));
        
        const ap = a * (1 + e) - PLANET.radius;
        const pe = a * (1 - e) - PLANET.radius;
        
        let eta = 0;
        const radialVel = vec.dot(this.vel, vec.norm(this.pos));
        if (radialVel > 0) eta = radialVel / (mu/(r*r));

        return { ap, pe, alt: r - PLANET.radius, eta, vel: v };
    }
}

// --- COMPILER & VM ---
class Compiler {
    tokenize(src) {
        src = src.replace(/\/\/.*/g, ''); // Comments
        // Added DECLARE, PARAMETER, SET to keywords
        const regex = /([a-zA-Z0-9_:]+|"[^"]*"|[-+*/=<>!]+|\{|\}|\(|\)|,|\.)/g;
        return (src.match(regex) || []).map(v => ({ 
            type: ['PRINT','WAIT','LOCK','TO','STAGE','CLEARSCREEN','IF','ELSE','UNTIL','AT','DECLARE','PARAMETER','SET'].includes(v) ? 'KEYWORD' : 'ATOM', 
            val: v 
        }));
    }

    compile(source) {
        const tokens = this.tokenize(source);
        const instructions = [];
        const stack = [];
        let lastClosedIf = null;
        
        const gather = (idx) => {
            let sub = [], i = idx;
            while(i < tokens.length && tokens[i].val !== '{' && tokens[i].val !== '.' && tokens[i].val !== 'AT') {
                sub.push(tokens[i].val); i++;
            }
            return { tokens: sub, end: i };
        };

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type !== 'KEYWORD' && t.val !== '}') continue;

            if (t.val === 'PRINT') {
                let res = gather(i+1);
                i = res.end;
                let at = null;
                if (tokens[i] && tokens[i].val === 'AT') {
                     at = [tokens[i+2].val, tokens[i+4].val];
                     i += 5;
                }
                instructions.push({ op: 'PRINT', expr: res.tokens, at });
            }
            else if (t.val === 'LOCK') {
                let target = tokens[i+1].val;
                let res = gather(i+3);
                i = res.end;
                instructions.push({ op: 'LOCK', target, expr: res.tokens });
            }
            // NEW: SET variable TO value
            else if (t.val === 'SET') {
                let target = tokens[i+1].val;
                // i+2 should be TO
                let res = gather(i+3);
                i = res.end;
                instructions.push({ op: 'SET_VAR', target, expr: res.tokens });
            }
            // NEW: DECLARE PARAMETER
            else if (t.val === 'DECLARE') {
                if (tokens[i+1] && tokens[i+1].val === 'PARAMETER') {
                    let param = tokens[i+2].val;
                    // Initialize to 0 so it doesn't crash calculations
                    instructions.push({ op: 'SET_VAR', target: param, expr: ['0'] });
                    i += 2; 
                }
            }
            else if (t.val === 'WAIT') {
                if (tokens[i+1].val === 'UNTIL') {
                    let startPc = instructions.length;
                    let res = gather(i+2);
                    i = res.end;
                    instructions.push({ op: 'JMP_TRUE', dest: startPc+3, expr: res.tokens });
                    instructions.push({ op: 'YIELD' });
                    instructions.push({ op: 'JMP', dest: startPc });
                } else {
                    instructions.push({ op: 'WAIT', time: parseFloat(tokens[i+1].val) });
                    i++;
                }
            }
            else if (t.val === 'STAGE') instructions.push({ op: 'STAGE' });
            else if (t.val === 'CLEARSCREEN') instructions.push({ op: 'CLEAR' });
            else if (t.val === 'IF') {
                let res = gather(i+1);
                i = res.end;
                let idx = instructions.length;
                instructions.push({ op: 'JMP_FALSE', dest: -1, expr: res.tokens });
                stack.push({ type: 'IF', idx });
            }
            // FIXED: ELSE LOGIC
            else if (t.val === 'ELSE') {
                if (lastClosedIf) {
                    // 1. Insert JUMP at end of IF (current pos) to skip ELSE
                    let jmpIdx = instructions.length;
                    instructions.push({ op: 'JMP', dest: -1 });
                    
                    // 2. Patch IF failure to jump here (Start of ELSE)
                    instructions[lastClosedIf.idx].dest = instructions.length;
                    
                    // 3. Push ELSE to stack
                    stack.push({ type: 'ELSE', idx: jmpIdx });
                    
                    lastClosedIf = null; // Consumed
                }
                i++; // Skip {
            }
            else if (t.val === 'UNTIL') {
                let start = instructions.length;
                let res = gather(i+1);
                i = res.end;
                let idx = instructions.length;
                instructions.push({ op: 'JMP_TRUE', dest: -1, expr: res.tokens });
                stack.push({ type: 'UNTIL', idx, start });
            }
            else if (t.val === '}') {
                if (stack.length) {
                    let info = stack.pop();
                    if (info.type === 'UNTIL') {
                        instructions.push({ op: 'YIELD' });
                        instructions.push({ op: 'JMP', dest: info.start });
                        instructions[info.idx].dest = instructions.length;
                    } else if (info.type === 'IF') {
                        instructions[info.idx].dest = instructions.length;
                        lastClosedIf = info; // Save for potential ELSE
                    } else {
                        instructions[info.idx].dest = instructions.length;
                    }
                }
            }
        }
        return instructions;
    }
}

class VM {
    constructor(phys, logFn) {
        this.phys = phys;
        this.log = logFn;
        this.compiler = new Compiler();
        this.instructions = [];
        this.pc = 0;
        this.running = false;
        this.waitTimer = 0;
        this.vars = {}; // Memory for variables
    }

    run(code) {
        try {
            this.vars = {}; // Reset vars
            this.instructions = this.compiler.compile(code);
            this.pc = 0;
            this.running = true;
            this.waitTimer = 0;
            this.log("Program Loaded.", "sys");
        } catch(e) { this.log("Compile Error: " + e.message, "err"); }
    }

    tick(dt) {
        if (!this.running) return;
        if (this.waitTimer > 0) { this.waitTimer -= dt; return; }

        let steps = 0;
        while(steps < 20 && this.pc < this.instructions.length) {
            const cmd = this.instructions[this.pc];
            
            if (cmd.op === 'YIELD') { this.pc++; break; }
            if (cmd.op === 'WAIT') { this.waitTimer = cmd.time; this.pc++; break; }
            
            if (cmd.op === 'PRINT') {
                const val = this.eval(cmd.expr);
                this.log(val, "info", cmd.at);
                this.pc++;
            }
            else if (cmd.op === 'LOCK') {
                const val = this.eval(cmd.expr);
                if (cmd.target === 'THROTTLE') this.phys.throttle = Math.min(Math.max(val,0),1);
                if (cmd.target === 'STEERING') this.phys.steeringTarget = val;
                this.pc++;
            }
            else if (cmd.op === 'SET_VAR') {
                const val = this.eval(cmd.expr);
                this.vars[cmd.target] = val;
                this.pc++;
            }
            else if (cmd.op === 'STAGE') {
                if (this.phys.stages > 0) {
                    this.phys.stages--;
                    this.phys.fuel = this.phys.fuelStart;
                    this.phys.massDry *= 0.6;
                    this.log("STAGED", "warn");
                }
                this.pc++;
            }
            else if (cmd.op === 'CLEAR') { 
                // Handled via callback in real app
                this.log("CLEAR");
                this.pc++; 
            }
            else if (cmd.op === 'JMP') this.pc = cmd.dest;
            else if (cmd.op === 'JMP_FALSE') this.pc = this.eval(cmd.expr) ? this.pc+1 : cmd.dest;
            else if (cmd.op === 'JMP_TRUE') this.pc = this.eval(cmd.expr) ? cmd.dest : this.pc+1;
            
            steps++;
        }
        if (this.pc >= this.instructions.length && this.running) {
            this.running = false;
            this.log("Program Ended.", "sys");
        }
    }

    eval(tokens) {
        let str = tokens.join(' ');
        const o = this.phys.getOrbit();
        str = str.replace(/HEADING\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g, "$2");
        str = str.replace(/ALTITUDE/g, o.alt);
        str = str.replace(/APOAPSIS/g, o.ap);
        str = str.replace(/PERIAPSIS/g, o.pe);
        str = str.replace(/ETA:APOAPSIS/g, o.eta);
        str = str.replace(/FUEL/g, this.phys.fuel / this.phys.fuelStart);
        str = str.replace(/THROTTLE/g, this.phys.throttle);
        str = str.replace(/ROUND\(([^)]+)\)/g, "Math.round($1)");
        
        // Variable replacement
        for (let key in this.vars) {
            // Simple replace, watch out for substrings (e.g. var 'a' inside 'apple')
            // Using regex word boundary to be safer
            let re = new RegExp("\\b" + key + "\\b", "g");
            str = str.replace(re, this.vars[key]);
        }

        try { return eval(str); } catch { return 0; }
    }
}