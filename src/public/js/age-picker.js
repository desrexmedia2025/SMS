// Age wheel picker.
//
// A cylindrical, draggable age selector. The years are bent around a wheel so
// the selected age sits front and centre while its neighbours curve away,
// blur and fade. It can be dragged with a pointer or a finger, flicked for
// momentum, snapped onto the nearest year, or clicked directly. Arrow keys
// move it one year at a time. The chosen age is written into a hidden input so
// the surrounding form submits it like any other field.
//
// Usage: give a container `data-age-picker` plus `data-min`, `data-max` and
// `data-value`. The picker builds the wheel inside it and keeps a hidden
// `<input name="age">` in step. Read the result with
// `window.SMSAgePicker.getAge(container)` or listen for the `agechange` event.
(function () {
  'use strict';

  var ITEM_HEIGHT = 46; // px each year occupies on the wheel
  var ANGLE = 15; // degrees of bend per year
  var RADIUS = ITEM_HEIGHT / Math.sin((ANGLE * Math.PI) / 180); // keeps spacing even
  var FADE_DISTANCE = 4.2; // years from centre before an item is fully faded
  var MAX_BLUR = 3.2; // px of blur at the edge of the wheel

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function buildWheel(root) {
    var min = parseInt(root.getAttribute('data-min'), 10);
    var max = parseInt(root.getAttribute('data-max'), 10);
    if (isNaN(min) || isNaN(max) || max < min) return null;
    var initial = parseInt(root.getAttribute('data-value'), 10);
    if (isNaN(initial)) initial = min;
    initial = clamp(initial, min, max);

    var ages = [];
    for (var age = min; age <= max; age += 1) ages.push(age);

    // --- DOM ---------------------------------------------------------------
    var viewport = document.createElement('div');
    viewport.className = 'age-wheel-viewport';

    var wheel = document.createElement('div');
    wheel.className = 'age-wheel';
    wheel.setAttribute('role', 'listbox');
    wheel.setAttribute('aria-label', 'Age');
    wheel.setAttribute('aria-orientation', 'vertical');

    var band = document.createElement('div');
    band.className = 'age-wheel-band';
    band.setAttribute('aria-hidden', 'true');

    var items = ages.map(function (value, index) {
      var item = document.createElement('div');
      item.className = 'age-wheel-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', value === initial ? 'true' : 'false');
      item.setAttribute('data-index', String(index));
      item.setAttribute('data-value', String(value));
      item.textContent = String(value);
      wheel.appendChild(item);
      return item;
    });

    viewport.appendChild(band);
    viewport.appendChild(wheel);

    var readout = document.createElement('div');
    readout.className = 'age-picker-readout';
    readout.innerHTML = 'Age <strong></strong> years';

    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'age';
    hidden.value = String(initial);
    hidden.setAttribute('data-age-input', '');

    root.appendChild(viewport);
    root.appendChild(readout);
    root.appendChild(hidden);

    // --- State -------------------------------------------------------------
    var position = ages.indexOf(initial); // continuous; integers centre a year
    var selectedIndex = position;
    var rafId = null;
    var dragging = false;
    var dragStartY = 0;
    var dragStartPosition = 0;
    var lastY = 0;
    var lastTime = 0;
    var velocity = 0; // years per millisecond
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function render() {
      for (var i = 0; i < items.length; i += 1) {
        var d = i - position;
        var abs = Math.abs(d);
        var item = items[i];
        item.style.transform =
          'rotateX(' + (d * ANGLE).toFixed(3) + 'deg) translateZ(' + RADIUS.toFixed(1) + 'px)';
        var opacity = clamp(1 - Math.max(0, abs - 0.6) / (FADE_DISTANCE - 0.6), 0, 1);
        item.style.opacity = opacity.toFixed(3);
        var blur = clamp((abs - 0.4) * 0.85, 0, MAX_BLUR);
        item.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
        var isSelected = i === selectedIndex;
        if (item.classList.contains('is-selected') !== isSelected) {
          item.classList.toggle('is-selected', isSelected);
          item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        }
      }
      readout.querySelector('strong').textContent = String(ages[selectedIndex]);
    }

    function commit(index, announce) {
      var next = clamp(Math.round(index), 0, ages.length - 1);
      var changed = next !== selectedIndex;
      selectedIndex = next;
      hidden.value = String(ages[next]);
      render();
      if (changed && announce !== false) {
        root.dispatchEvent(
          new CustomEvent('agechange', { detail: { age: ages[next], index: next }, bubbles: true })
        );
      }
    }

    function stopAnimation() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    // Animate the wheel from its current position to a target index.
    function animateTo(target, duration) {
      stopAnimation();
      var from = position;
      var to = clamp(target, 0, ages.length - 1);
      if (reducedMotion || duration <= 0 || Math.abs(to - from) < 0.001) {
        position = to;
        commit(to);
        return;
      }
      var start = null;
      function step(now) {
        if (start === null) start = now;
        var t = clamp((now - start) / duration, 0, 1);
        position = from + (to - from) * easeOutCubic(t);
        // Keep the highlighted year honest while the wheel is still moving.
        selectedIndex = clamp(Math.round(position), 0, ages.length - 1);
        render();
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          rafId = null;
          commit(to);
        }
      }
      rafId = requestAnimationFrame(step);
    }

    // Momentum: after a flick the wheel keeps travelling, slowing down, then
    // snaps onto the nearest year.
    function applyMomentum() {
      var last = null;
      function step(now) {
        if (last === null) last = now;
        var dt = Math.min(32, now - last);
        last = now;
        position += velocity * dt;
        velocity *= Math.pow(0.94, dt / 16.7);
        if (position < 0) {
          position = 0;
          velocity = 0;
        } else if (position > ages.length - 1) {
          position = ages.length - 1;
          velocity = 0;
        }
        selectedIndex = clamp(Math.round(position), 0, ages.length - 1);
        render();
        if (Math.abs(velocity) > 0.0004) {
          rafId = requestAnimationFrame(step);
        } else {
          rafId = null;
          animateTo(Math.round(position), 260);
        }
      }
      rafId = requestAnimationFrame(step);
    }

    // --- Pointer: drag, flick, click --------------------------------------
    viewport.addEventListener('pointerdown', function (event) {
      stopAnimation();
      dragging = true;
      dragStartY = event.clientY;
      dragStartPosition = position;
      lastY = event.clientY;
      lastTime = event.timeStamp;
      velocity = 0;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    });

    viewport.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var deltaYears = (dragStartY - event.clientY) / ITEM_HEIGHT;
      position = clamp(dragStartPosition + deltaYears, 0, ages.length - 1);
      var dt = event.timeStamp - lastTime;
      if (dt > 0) {
        var instant = (lastY - event.clientY) / ITEM_HEIGHT / dt;
        velocity = velocity * 0.7 + instant * 0.3;
      }
      lastY = event.clientY;
      lastTime = event.timeStamp;
      selectedIndex = clamp(Math.round(position), 0, ages.length - 1);
      render();
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('is-dragging');
      if (Math.abs(velocity) > 0.002 && !reducedMotion) {
        applyMomentum();
      } else {
        animateTo(Math.round(position), 240);
      }
    }

    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // Clicking a year spins it into the centre.
    wheel.addEventListener('click', function (event) {
      var item = event.target.closest('.age-wheel-item');
      if (!item) return;
      var index = parseInt(item.getAttribute('data-index'), 10);
      if (!isNaN(index)) animateTo(index, 320);
    });

    // Mouse wheel scrolls the years too.
    viewport.addEventListener(
      'wheel',
      function (event) {
        event.preventDefault();
        stopAnimation();
        var step = event.deltaY > 0 ? 1 : -1;
        animateTo(clamp(Math.round(position) + step, 0, ages.length - 1), 200);
      },
      { passive: false }
    );

    // Keyboard: the wheel is a listbox, arrows move one year at a time.
    viewport.setAttribute('tabindex', '0');
    viewport.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        animateTo(clamp(selectedIndex + 1, 0, ages.length - 1), 200);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        animateTo(clamp(selectedIndex - 1, 0, ages.length - 1), 200);
      } else if (event.key === 'Home') {
        event.preventDefault();
        animateTo(0, 260);
      } else if (event.key === 'End') {
        event.preventDefault();
        animateTo(ages.length - 1, 260);
      }
    });

    render();

    return {
      root: root,
      getAge: function () {
        return ages[selectedIndex];
      },
      setAge: function (age) {
        var index = ages.indexOf(clamp(age, min, max));
        if (index !== -1) animateTo(index, 260);
      },
      focus: function () {
        viewport.focus();
      },
    };
  }

  var registry = new Map();

  function mountAll(scope) {
    var roots = (scope || document).querySelectorAll('[data-age-picker]');
    roots.forEach(function (root) {
      if (registry.has(root)) return;
      var picker = buildWheel(root);
      if (picker) registry.set(root, picker);
    });
  }

  function getPicker(root) {
    return registry.get(root) || null;
  }

  function getAge(root) {
    var picker = getPicker(root);
    return picker ? picker.getAge() : null;
  }

  // Date of birth implied by an age: the first of January in the year the
  // person turns that age. The backend stores a date, so the wheel hands the
  // form a real date rather than a bare number.
  function dateOfBirthForAge(age) {
    var year = new Date().getFullYear() - Number(age);
    return year + '-01-01';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mountAll(document);
    });
  } else {
    mountAll(document);
  }

  window.SMSAgePicker = {
    mount: mountAll,
    getPicker: getPicker,
    getAge: getAge,
    dateOfBirthForAge: dateOfBirthForAge,
  };
})();
