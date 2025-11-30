/**
 * FRONTEND APP
 * Handles DOM, Rendering, and User Input.
 * Connects to the Engine.
 */

// Helper: Safely get numbers from inputs
const getNum = (id, def) => {
    const el = document.getElementById(id);
    if (!el) return def;
    const val = parseFloat(el.value);
    return isNaN(val) ? def : val;
};

// --- INITIALIZATION ---
const physics = new Physics();
const vm = new VM(physics, (msg, type, at) => logTerminal(msg, type, at));
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// --- TERMINAL UTILS ---
function logTerminal(msg, type = "info", at = null) {
    if (msg === undefined || msg === null) return;
    
    // Check if CLEAR command
    if (msg === "CLEAR") {
        document.getElementById('terminal').innerHTML = "";
        return;
    }

    // "Print At" Emulation: If coordinates provided, we assume it's status text
    // We will just log it normally for this version to ensure readability
    const term = document.getElementById('terminal');
    const line = document.createElement('div');
    line.className = "term-line log-" + type;
    
    // Beautify numbers
    if (typeof msg === 'number') msg = msg.toFixed(2);
    
    line.innerText = "> " + msg;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

// --- CONTROLS ---
document.getElementById('btn-run').onclick = () => {
    resetSim();
    vm.run(document.getElementById('code').value);
};

document.getElementById('btn-stop').onclick = () => {
    vm.running = false;
    logTerminal("Aborted by user.", "err");
};

document.getElementById('btn-reset').onclick = resetSim;

function resetSim() {
    // Read Config Safely (Fixes NaN bug)
    const config = {
        thrust: getNum('cfg-thrust', 500),
        mass: getNum('cfg-mass', 25),
        fuel: getNum('cfg-fuel', 600),
        stages: getNum('cfg-stages', 2)
    };
    
    physics.reset(config);
    vm.running = false;
    document.getElementById('terminal').innerHTML = '<div class="term-line log-sys">System Ready.</div>';
    document.getElementById('warnings').style.display = 'none';
    logTerminal("Simulation Reset.", "sys");
}

// --- RENDER LOOP ---
function resize() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resize);
resize();

function loop() {
    const dt = 0.02; // 50hz
    
    // 1. Tick Logic
    try {
        vm.tick(dt);
        physics.step(dt);
    } catch (e) {
        console.error(e);
        vm.running = false;
    }

    // 2. Render
    render();
    
    // 3. UI Updates
    updateHUD();
    
    requestAnimationFrame(loop);
}

function render() {
    const w = canvas.width;
    const h = canvas.height;
    const orb = physics.getOrbit();

    // Sky Color
    const skyFactor = Math.max(0, 1 - orb.alt/50000);
    ctx.fillStyle = `rgb(${135*skyFactor}, ${206*skyFactor}, ${235*skyFactor})`;
    if (orb.alt > 50000) ctx.fillStyle = "#000";
    ctx.fillRect(0,0,w,h);

    // Camera transform
    ctx.save();
    ctx.translate(w/2, h*0.8);

    // Rocket Rotation (Visual)
    const visRot = (physics.angle - 90) * -Math.PI/180;
    
    // Draw Planet (Relative to rocket)
    // Parallax effect for planet curve
    const camY = Math.min(orb.alt, 200000) * 0.1;
    ctx.translate(0, camY);
    ctx.rotate(visRot);
    
    ctx.fillStyle = "#4CAF50";
    ctx.beginPath();
    ctx.arc(0, 600000 + 100, 600000, 0, Math.PI*2);
    ctx.fill();

    // Atmosphere Halo
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 100;
    ctx.beginPath();
    ctx.arc(0, 600000 + 100, 600000 + 3000, 0, Math.PI*2);
    ctx.stroke();

    ctx.restore();

    // Draw Rocket (Fixed center)
    ctx.save();
    ctx.translate(w/2, h*0.8);
    ctx.rotate(visRot);

    // Flame
    if (physics.throttle > 0 && physics.fuel > 0) {
        ctx.fillStyle = "#FF5722";
        ctx.beginPath();
        ctx.moveTo(-5, 20); ctx.lineTo(5, 20); ctx.lineTo(0, 40 + Math.random()*20);
        ctx.fill();
    }

    // Ship Body
    ctx.fillStyle = "#ECECEC";
    ctx.fillRect(-8, -20, 16, 40);
    // Fins
    ctx.fillStyle = "#607D8B";
    ctx.beginPath(); ctx.moveTo(-8,20); ctx.lineTo(-16,30); ctx.lineTo(-8,0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8,20); ctx.lineTo(16,30); ctx.lineTo(8,0); ctx.fill();
    // Capsule
    ctx.fillStyle = "#333";
    ctx.beginPath(); ctx.moveTo(-8,-20); ctx.lineTo(8,-20); ctx.lineTo(0,-35); ctx.fill();
    
    ctx.restore();
}

function updateHUD() {
    const o = physics.getOrbit();
    
    // Warning System
    const warningEl = document.getElementById('warnings');
    if (o.alt < 0 && !physics.landed && !physics.crashed) {
        warningEl.style.display = 'block';
        warningEl.innerText = "TERRAIN PULL UP";
    } else if (physics.crashed) {
        warningEl.style.display = 'block';
        warningEl.innerText = "VESSEL DESTROYED";
    } else {
        warningEl.style.display = 'none';
    }

    // Telemetry
    const html = `
        ALT: ${(o.alt/1000).toFixed(1)} km<br>
        AP:  ${(o.ap/1000).toFixed(1)} km<br>
        PE:  ${(o.pe/1000).toFixed(1)} km<br>
        VEL: ${o.vel.toFixed(0)} m/s<br>
        FUEL: ${physics.fuel.toFixed(0)}<br>
        THR: ${(physics.throttle*100).toFixed(0)}%
    `;
    document.getElementById('hud').innerHTML = html;
}

// Start
resetSim();
loop();