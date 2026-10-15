/**
 * Grupo Zentra — Master FX & Interactive Motion Engine
 * Synthesizing:
 *  1. Liquid Iridescent Atmospheric Fluid Shader (Monopo Saigon / DESIGN.md)
 *  2. Morphing Constellation Particle Physics Engine (zentraproducoes.netlify.app)
 *  3. Specular 3D Tilt Hologram Cards
 *  4. Real-time Checkout & Revenue Fee Simulator
 */

(function () {
  'use strict';

  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSmall = window.matchMedia('(max-width: 768px)').matches;
  const RENDER_SCALE = isSmall ? 0.3 : 0.45;
  const FRAME_MS = isSmall ? 1000 / 24 : 1000 / 40;
  let lastFrame = 0;
  function shouldSkip(now) {
    if (document.hidden) return true;
    if (now - lastFrame < FRAME_MS) return true;
    lastFrame = now;
    return false;
  }
  // Desktop: start when idle after load. Mobile: on first interaction or 3s after load,
  // so the shader never competes with first paint on slow phones.
  function startLater(fn) {
    let started = false;
    const run = function () { if (started) return; started = true; requestAnimationFrame(fn); };
    const go = isSmall
      ? function () {
          setTimeout(run, 3000);
          ['touchstart', 'scroll', 'pointerdown'].forEach(function (e) { window.addEventListener(e, run, { once: true, passive: true }); });
        }
      : function () { (window.requestIdleCallback || setTimeout)(run, { timeout: 1200 }); };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }

  /* ==========================================================================
     1. LIQUID IRIDESCENT ATMOSPHERIC FLUID CANVAS (#fx-liquid)
     ========================================================================== */
  const LiquidShader = (function () {
    let canvas = document.getElementById('fx-liquid');
    if (!canvas) return { setMouse() {} };

    // Try WebGL first for ultra-smooth fluid gradient distortion
    // Software-rendered WebGL (no GPU) blocks the main thread: treat as unavailable
    const glOpts = { failIfMajorPerformanceCaveat: true, antialias: false, depth: false, powerPreference: 'low-power' };
    let gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) {
        gl = null;
        const fresh = canvas.cloneNode(false); // a canvas keeps its first context type
        canvas.replaceWith(fresh);
        canvas = fresh;
      }
    }
    let width = 0, height = 0, dpr = 1;
    let mouseX = 0.5, mouseY = 0.5;
    let targetMX = 0.5, targetMY = 0.5;

    if (!gl) {
      // Fallback: 2D radial fluid flow
      const ctx = canvas.getContext('2d');
      let t = 0;
      function resize2D() {
        dpr = RENDER_SCALE;
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      window.addEventListener('resize', function () { resize2D(); draw2D(performance.now()); });
      resize2D();

      function draw2D(now) {
        t = now * 0.0006;
        ctx.fillStyle = '#080809';
        ctx.fillRect(0, 0, width, height);


        // Minimalist fluid wash 1 (Charcoal smoke)
        const g1 = ctx.createRadialGradient(
          width * (0.35 + Math.sin(t) * 0.12),
          height * (0.4 + Math.cos(t * 0.8) * 0.12),
          10,
          width * 0.35,
          height * 0.4,
          width * 0.55
        );
        g1.addColorStop(0, 'rgba(40, 40, 48, 0.25)');
        g1.addColorStop(1, 'transparent');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, width, height);

        // Minimalist fluid wash 2 (Subtle Champagne Gold)
        const g2 = ctx.createRadialGradient(
          width * (0.68 + Math.cos(t * 0.7) * 0.15),
          height * (0.45 + Math.sin(t * 0.9) * 0.15),
          20,
          width * 0.68,
          height * 0.45,
          width * 0.55
        );
        g2.addColorStop(0, 'rgba(201, 169, 110, 0.08)');
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, width, height);

        // Minimalist fluid wash 3 (Soft Pearl Mist)
        const g3 = ctx.createRadialGradient(
          width * (0.5 + Math.sin(t * 1.1) * 0.15),
          height * (0.75 + Math.cos(t * 0.6) * 0.12),
          30,
          width * 0.5,
          height * 0.75,
          width * 0.45
        );
        g3.addColorStop(0, 'rgba(245, 240, 235, 0.03)');
        g3.addColorStop(1, 'transparent');
        ctx.fillStyle = g3;
        ctx.fillRect(0, 0, width, height);

        // static frame only: animated 2D gradients cost too much CPU
      }
      startLater(draw2D);
      return {
        setMouse(x, y) {
          targetMX = x / width;
          targetMY = y / height;
        }
      };
    }

    // --- WebGL Shader Implementation ---
    const vertSource = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_pos + 1.0) * 0.5;
        v_uv.y = 1.0 - v_uv.y;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    // Minimalist molten liquid silk fragment shader with domain warping & champagne gold caustics
    const fragSource = `
      precision mediump float;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec2 u_mouse;
      varying vec2 v_uv;

      // Simplex noise approximation
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 st = gl_FragCoord.xy / u_res.xy;
        float aspect = u_res.x / u_res.y;
        vec2 p = st;
        p.x *= aspect;

        float t = u_time * 0.14;

        // Smooth mouse displacement vector
        vec2 m = u_mouse;
        m.x *= aspect;
        float dMouse = distance(p, m);
        float mousePush = smoothstep(0.42, 0.0, dMouse) * 0.09;

        // Multi-octave organic domain warping
        vec2 q = vec2(0.0);
        q.x = snoise(p * 1.2 + vec2(t * 0.6, t * 0.4));
        q.y = snoise(p * 1.2 + vec2(1.2 - t * 0.5, 2.4 + t * 0.3));

        vec2 r = vec2(0.0);
        r.x = snoise(p * 1.8 + 1.1 * q + vec2(1.7, 9.2) + 0.12 * t + mousePush);
        r.y = snoise(p * 1.8 + 1.1 * q + vec2(8.3, 2.8) + 0.10 * t - mousePush);

        float f = snoise(p * 1.0 + r * 1.3);

        // Minimalist Luxury Palette: Deep Obsidian, Charcoal Silk, and Zentra Champagne Gold
        vec3 cObsidian = vec3(0.020, 0.020, 0.024); // Pure dark base
        vec3 cCharcoal = vec3(0.055, 0.056, 0.068); // Soft dark fluid volume
        vec3 cGoldWarm = vec3(0.788, 0.663, 0.431); // Signature Zentra Champagne Gold (#C9A96E)
        vec3 cPlatinum = vec3(0.920, 0.900, 0.870); // Soft pearl sheen

        // Silk light modulation
        float smoke = smoothstep(-0.35, 0.65, f + q.x * 0.4);
        float goldGlint = smoothstep(0.35, 0.95, r.x * 0.8 + f * 0.6);
        float pearlRim = smoothstep(0.55, 0.98, r.y + f * 0.5);

        // Start from deep obsidian
        vec3 col = cObsidian;
        // Blend silky charcoal waves
        col = mix(col, cCharcoal, smoke * 0.65);
        // Add subtle champagne gold shimmer (controlled and minimalist)
        col += cGoldWarm * goldGlint * 0.12;
        // Add delicate pearl liquid caustics
        col += cPlatinum * pearlRim * 0.05;

        // Soft center vignette so content and typography are crisp and uncluttered
        float centerFocus = smoothstep(1.3, 0.25, distance(st, vec2(0.5, 0.45)));
        col *= mix(0.70, 1.0, centerFocus);

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function createShader(gl, type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Shader error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = createShader(gl, gl.VERTEX_SHADER, vertSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragSource);
    if (!vs || !fs) return { setMouse() {} };

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPosLoc = gl.getAttribLocation(program, 'a_pos');
    const uResLoc = gl.getUniformLocation(program, 'u_res');
    const uTimeLoc = gl.getUniformLocation(program, 'u_time');
    const uMouseLoc = gl.getUniformLocation(program, 'u_mouse');

    function resizeGL() {
      dpr = RENDER_SCALE;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    let lastW = window.innerWidth;
    window.addEventListener('resize', function () { if (!isSmall || window.innerWidth !== lastW) { lastW = window.innerWidth; resizeGL(); } });
    resizeGL();

    let startTime = performance.now();
    function renderGL(now) {
      if (shouldSkip(now)) { requestAnimationFrame(renderGL); return; }
      // Smooth lerp mouse
      mouseX += (targetMX - mouseX) * 0.05;
      mouseY += (targetMY - mouseY) * 0.05;

      const time = (now - startTime) * 0.001;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uResLoc, canvas.width, canvas.height);
      gl.uniform1f(uTimeLoc, time);
      gl.uniform2f(uMouseLoc, mouseX, mouseY);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!isReducedMotion) requestAnimationFrame(renderGL);
    }
    startLater(renderGL);

    return {
      setMouse(x, y) {
        targetMX = x / window.innerWidth;
        targetMY = y / window.innerHeight;
      }
    };
  })();

  /* ==========================================================================
     2. PARTICLES DISABLED (Minimalist Pure Liquid Silk Background)
     ========================================================================== */
  const FX = {
    setMode: function () {},
    pulse: function () {},
    getMode: function () { return 'liquid'; }
  };

  /* ==========================================================================
     3. 3D PERSPECTIVE TILT CARDS WITH SPECULAR RADIAL GLARE
     ========================================================================== */
  if (window.matchMedia('(pointer: fine)').matches && !isReducedMotion) {
    document.querySelectorAll('[data-tilt]').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (y * 100).toFixed(1) + '%');

        const tiltX = (0.5 - y) * 5;
        const tiltY = (x - 0.5) * 6;
        card.style.transform = `perspective(900px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) translateZ(0)`;
      });

      card.addEventListener('pointerleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ==========================================================================
     4. INTERACTIVE CHECKOUT & FEE ECONOMY SIMULATOR
     ========================================================================== */
  const revInput = document.getElementById('rev');
  const revOut = document.getElementById('revOut');
  const feeOld = document.getElementById('feeOld');
  const feeNew = document.getElementById('feeNew');
  const keepM = document.getElementById('keepM');
  const keepY = document.getElementById('keepY');

  const formatBRL = function (v) {
    return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  };

  function updateSimulator() {
    if (!revInput) return;
    const v = Number(revInput.value);
    const min = Number(revInput.min) || 20000;
    const max = Number(revInput.max) || 1000000;
    const pct = ((v - min) / (max - min)) * 100;

    revInput.style.setProperty('--range-pct', pct + '%');

    if (revOut) revOut.textContent = formatBRL(v);

    // Traditional platforms take up to 10%
    const oldFee = v * 0.10;
    // Zentra Vero checkout ~3%
    const newFee = v * 0.03;
    // Difference retained in the expert's bank account (~7%)
    const diffMonth = v * 0.07;
    const diffYear = diffMonth * 12;

    if (feeOld) feeOld.textContent = formatBRL(oldFee);
    if (feeNew) feeNew.textContent = formatBRL(newFee);
    if (keepM) keepM.textContent = formatBRL(diffMonth) + ' / mês';
    if (keepY) keepY.textContent = formatBRL(diffYear) + ' por ano';

    FX.pulse();
  }

  if (revInput) {
    revInput.addEventListener('input', updateSimulator);
    updateSimulator();
  }

  /* ==========================================================================
     5. FX MODE HUD BUTTONS (Interactive test controls)
     ========================================================================== */
  document.querySelectorAll('.fx-hud-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const targetMode = btn.dataset.mode;
      if (targetMode) FX.setMode(targetMode);
    });
  });

  /* ==========================================================================
     6. SCROLL SPY FOR SECTION-LINKED PARTICLE MORPHING
     ========================================================================== */
  const sectionModes = [
    { id: 'hero', mode: 'orbit' },
    { id: 'como-ajudamos', mode: 'network' },
    { id: 'pilares', mode: 'grid' },
    { id: 'simulador', mode: 'funnel' },
    { id: 'case-angela', mode: 'converge' },
    { id: 'fundadores', mode: 'orbit' },
    { id: 'contato', mode: 'burst' }
  ];

  let ticking = false;
  function onScroll() {
    // Nav header background blur on scroll
    const nav = document.querySelector('.nav-header');
    if (nav) {
      nav.classList.toggle('is-scrolled', window.scrollY > 40);
    }

    // Determine current section in viewport
    const midPoint = window.innerHeight * 0.45;
    for (let i = sectionModes.length - 1; i >= 0; i--) {
      const entry = sectionModes[i];
      const el = document.getElementById(entry.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= midPoint && rect.bottom >= midPoint) {
          FX.setMode(entry.mode);
          break;
        }
      }
    }
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        onScroll();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  /* ==========================================================================
     7. HERO LOGO STROKE DRAW & ROTATING BADGE INTERACTION
     ========================================================================== */
  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      const logo = document.querySelector('.hero-logo-center');
      if (logo) logo.classList.add('is-drawn');
    }, 250);
  });

  const rotatingBadge = document.querySelector('.rotating-badge-wrap');
  if (rotatingBadge) {
    rotatingBadge.addEventListener('click', function () {
      const nextEl = document.getElementById('como-ajudamos');
      if (nextEl) nextEl.scrollIntoView({ behavior: 'smooth' });
    });
  }

  /* ==========================================================================
     8. FAQ ACCORDION INTERACTIVITY
     ========================================================================== */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    const trigger = item.querySelector('.faq-trigger');
    const content = item.querySelector('.faq-content');

    if (trigger && content) {
      trigger.addEventListener('click', function () {
        const isOpen = item.classList.contains('is-open');

        // Close other items
        document.querySelectorAll('.faq-item').forEach(function (other) {
          if (other !== item) {
            other.classList.remove('is-open');
            const otherContent = other.querySelector('.faq-content');
            if (otherContent) otherContent.style.maxHeight = null;
          }
        });

        // Toggle current item
        if (isOpen) {
          item.classList.remove('is-open');
          content.style.maxHeight = null;
        } else {
          item.classList.add('is-open');
          content.style.maxHeight = content.scrollHeight + 'px';
        }
      });
    }
  });

  // Expose FX to window for console experimentation
  window.ZentraFX = FX;
})();
