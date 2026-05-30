/* ============================================================
   PANINI PANO — Interactive Site Script
   ============================================================ */

'use strict';

/* ---------------------------------------------------------- */
/* 1. NAV — scroll shadow + active section highlighting        */
/* ---------------------------------------------------------- */

const nav = document.getElementById('nav');

window.addEventListener('scroll', () => {
  nav.classList.toggle('nav--scrolled', window.scrollY > 20);
}, { passive: true });

// Active nav link via IntersectionObserver
const navTargets = document.querySelectorAll('[data-nav-target]');
const navLinks   = document.querySelectorAll('.nav__links a[data-nav-target]');

const sections = {};
navLinks.forEach(link => {
  const id = link.getAttribute('data-nav-target');
  const el = document.getElementById(id);
  if (el) sections[id] = el;
});

if (Object.keys(sections).length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      navLinks.forEach(link => {
        link.classList.toggle('is-active', link.getAttribute('data-nav-target') === id);
      });
    });
  }, { threshold: 0.35, rootMargin: '-72px 0px 0px 0px' });

  Object.values(sections).forEach(el => sectionObserver.observe(el));
}

/* ---------------------------------------------------------- */
/* 2. MOBILE HAMBURGER MENU                                    */
/* ---------------------------------------------------------- */

const hamburger      = document.getElementById('navHamburger');
const navLinksList   = document.getElementById('navLinks');
const mobileOverlay  = document.getElementById('mobileOverlay');

function openMobileMenu() {
  hamburger.classList.add('is-open');
  navLinksList.classList.add('is-open');
  mobileOverlay.classList.add('is-open');
  hamburger.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  hamburger.classList.remove('is-open');
  navLinksList.classList.remove('is-open');
  mobileOverlay.classList.remove('is-open');
  hamburger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

hamburger.addEventListener('click', () => {
  hamburger.classList.contains('is-open') ? closeMobileMenu() : openMobileMenu();
});

mobileOverlay.addEventListener('click', closeMobileMenu);

navLinksList.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', closeMobileMenu);
});

/* ---------------------------------------------------------- */
/* 3. SMOOTH SCROLL for anchor links                           */
/* ---------------------------------------------------------- */

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const href   = anchor.getAttribute('href');
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    const offset = 72; // nav height
    const top    = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* ---------------------------------------------------------- */
/* 4. SCROLL REVEAL ANIMATIONS (IntersectionObserver)          */
/* ---------------------------------------------------------- */

const revealEls = document.querySelectorAll('.reveal-up');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });

revealEls.forEach(el => revealObserver.observe(el));

// Aggressive fallback — reveal anything near/in viewport immediately + after delays
function revealVisible() {
  revealEls.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) {
      el.classList.add('is-visible');
      revealObserver.unobserve(el);
    }
  });
}
requestAnimationFrame(revealVisible);
setTimeout(revealVisible, 200);
setTimeout(revealVisible, 600);
// Nuclear fallback: show everything after 1.2s no matter what
setTimeout(() => revealEls.forEach(el => el.classList.add('is-visible')), 1200);

// Section title underline draw
const sectionTitles = document.querySelectorAll('.section-title');
const titleObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    titleObserver.unobserve(entry.target);
  });
}, { threshold: 0.5 });

sectionTitles.forEach(t => titleObserver.observe(t));

/* ---------------------------------------------------------- */
/* 5. MANDALA PULSE on scroll-enter                            */
/* ---------------------------------------------------------- */

const mandala = document.getElementById('mandala');
if (mandala) {
  const mandalaObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      mandala.classList.remove('pulse-enter');
      // Force reflow
      void mandala.offsetWidth;
      mandala.classList.add('pulse-enter');
      mandalaObserver.unobserve(mandala);
    });
  }, { threshold: 0.5 });

  mandalaObserver.observe(mandala);
}

/* ---------------------------------------------------------- */
/* 6. GRAYSCALE → COLOR REVEAL on peek images                  */
/* ---------------------------------------------------------- */

const revealImages = document.querySelectorAll('.inside__img[data-reveal]');

const colorObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;

    const img   = entry.target;
    const index = Array.from(revealImages).indexOf(img);
    const delay = index * 200;

    setTimeout(() => {
      img.classList.add('is-sepia');
      setTimeout(() => {
        img.classList.remove('is-sepia');
        img.classList.add('is-color');
      }, 800);
    }, delay);

    colorObserver.unobserve(img);
  });
}, { threshold: 0.2 });

revealImages.forEach(img => colorObserver.observe(img));

/* ---------------------------------------------------------- */
/* 7. LIGHTBOX                                                  */
/* ---------------------------------------------------------- */

const lightbox        = document.getElementById('lightbox');
const lightboxImg     = document.getElementById('lightboxImg');
const lightboxBackdrop = document.getElementById('lightboxBackdrop');
const lightboxClose   = document.getElementById('lightboxClose');
const lightboxPrev    = document.getElementById('lightboxPrev');
const lightboxNext    = document.getElementById('lightboxNext');
const lightboxCounter = document.getElementById('lightboxCounter');
const lightboxSpinner = document.getElementById('lightboxSpinner');

// Gallery images — gathered from all .inside__img elements + gen-gallery items
let galleryImages = [];
let currentIndex  = 0;

function buildGallery() {
  galleryImages = [];
  document.querySelectorAll('.inside__img[data-gallery-index]').forEach(img => {
    galleryImages.push({ src: img.src, alt: img.alt });
  });
  // Gen gallery items added dynamically — updated when gen gallery loads
}

function openLightbox(index) {
  currentIndex = index;
  showLightboxImage(currentIndex);
  lightbox.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  lightboxClose.focus();
}

function closeLightbox() {
  lightbox.classList.remove('is-open');
  document.body.style.overflow = '';
  // Reset image so transition plays on re-open
  setTimeout(() => {
    lightboxImg.src = '';
    lightboxImg.style.opacity = '0';
  }, 300);
}

function showLightboxImage(index) {
  const item = galleryImages[index];
  if (!item) return;

  lightboxImg.style.opacity = '0';
  lightboxSpinner.classList.add('is-loading');

  const tempImg = new Image();
  tempImg.onload = () => {
    lightboxImg.src = item.src;
    lightboxImg.alt = item.alt || '';
    lightboxSpinner.classList.remove('is-loading');
    lightboxImg.style.opacity = '1';
  };
  tempImg.onerror = () => {
    lightboxSpinner.classList.remove('is-loading');
  };
  tempImg.src = item.src;

  lightboxCounter.textContent = `${index + 1} / ${galleryImages.length}`;

  lightboxPrev.style.visibility = galleryImages.length > 1 ? 'visible' : 'hidden';
  lightboxNext.style.visibility = galleryImages.length > 1 ? 'visible' : 'hidden';
}

function prevImage() {
  currentIndex = (currentIndex - 1 + galleryImages.length) % galleryImages.length;
  showLightboxImage(currentIndex);
}

function nextImage() {
  currentIndex = (currentIndex + 1) % galleryImages.length;
  showLightboxImage(currentIndex);
}

lightboxClose.addEventListener('click', closeLightbox);
lightboxBackdrop.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', prevImage);
lightboxNext.addEventListener('click', nextImage);

document.addEventListener('keydown', e => {
  if (!lightbox.classList.contains('is-open')) return;
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   prevImage();
  if (e.key === 'ArrowRight')  nextImage();
});

// Touch/swipe on lightbox
let touchStartX = 0;
lightbox.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });

lightbox.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) {
    dx < 0 ? nextImage() : prevImage();
  }
}, { passive: true });

// Bind inside images to lightbox
buildGallery();

document.querySelectorAll('.inside__item').forEach(item => {
  item.addEventListener('click', () => {
    const img   = item.querySelector('.inside__img');
    const index = parseInt(img.getAttribute('data-gallery-index'), 10);
    if (!isNaN(index)) openLightbox(index);
  });
});

/* ---------------------------------------------------------- */
/* 8. WATCH THE PROCESS — canvas animation + video fallback    */
/* ---------------------------------------------------------- */

const processVideo      = document.getElementById('processVideo');
const processCanvasWrap = document.getElementById('processCanvasWrap');
const processCanvas     = document.getElementById('processCanvas');
const processPlayBtn    = document.getElementById('processPlayBtn');
const playIcon          = processPlayBtn ? processPlayBtn.querySelector('svg') : null;

// Try to load video
if (processVideo) {
  processVideo.addEventListener('loadeddata', () => {
    processVideo.classList.add('is-loaded');
    processCanvasWrap.classList.add('is-hidden');
    stopCanvasAnimation();
  });

  processVideo.addEventListener('error', () => {
    // Video not found — canvas stays visible
    processVideo.style.display = 'none';
  });

  // If no source loads within 1.5s, assume no video
  setTimeout(() => {
    if (!processVideo.classList.contains('is-loaded')) {
      processVideo.style.display = 'none';
    }
  }, 1500);
}

// Play/pause button
let videoPlaying = true;
let canvasPlaying = true;

if (processPlayBtn) {
  processPlayBtn.addEventListener('click', () => {
    if (processVideo.classList.contains('is-loaded')) {
      // Video mode
      if (videoPlaying) {
        processVideo.pause();
        processPlayBtn.classList.add('is-paused');
      } else {
        processVideo.play();
        processPlayBtn.classList.remove('is-paused');
      }
      videoPlaying = !videoPlaying;
    } else {
      // Canvas mode
      if (canvasPlaying) {
        stopCanvasAnimation();
        processPlayBtn.classList.add('is-paused');
      } else {
        startCanvasAnimation();
        processPlayBtn.classList.remove('is-paused');
      }
      canvasPlaying = !canvasPlaying;
    }
  });
}

// ---- Canvas Mandala Drawing Animation ----
let canvasRaf = null;
let canvasProgress = 0; // 0 → 1 overall draw progress
const CANVAS_DURATION = 9000; // ms per full cycle
let canvasStart = null;

function drawMandalaCanvas(ctx, width, height, progress) {
  ctx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.42;

  // Dark background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  // Subtle star field
  ctx.save();
  const starCount = 80;
  for (let i = 0; i < starCount; i++) {
    // Deterministic but scattered
    const sx = ((i * 137.5 + 20) % width);
    const sy = ((i * 97.3 + 40) % height);
    const sr = 0.5 + (i % 3) * 0.4;
    const alpha = 0.15 + (i % 5) * 0.08;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
  }
  ctx.restore();

  // Amber glow at center
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.4);
  grad.addColorStop(0,   'rgba(232,140,58,0.08)');
  grad.addColorStop(0.5, 'rgba(42,107,110,0.04)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Draw concentric circles progressively
  const rings = [0.95, 0.84, 0.72, 0.57, 0.38, 0.22];
  const ringColors = ['#E88C3A', '#2A6B6E', '#E88C3A', '#2A6B6E', '#E88C3A', '#2A6B6E'];

  rings.forEach((ratio, i) => {
    const ringThreshold = i / rings.length;
    if (progress < ringThreshold) return;
    const ringProgress = Math.min(1, (progress - ringThreshold) / (1 / rings.length));
    const r = maxR * ratio;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringProgress);
    ctx.strokeStyle = hexToRgba(ringColors[i], 0.45 + ringProgress * 0.25);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  });

  // Draw petals (12 petals, 2 rings)
  const petalGroups = [
    { count: 12, r: maxR * 0.68, rx: maxR * 0.11, ry: maxR * 0.26, color: '#E88C3A', alpha: 0.55, startAt: 0.35 },
    { count: 12, r: maxR * 0.50, rx: maxR * 0.07, ry: maxR * 0.19, color: '#2A6B6E', alpha: 0.5,  startAt: 0.55 },
    { count: 8,  r: maxR * 0.30, rx: maxR * 0.06, ry: maxR * 0.13, color: '#E88C3A', alpha: 0.4,  startAt: 0.72 },
  ];

  petalGroups.forEach(group => {
    if (progress < group.startAt) return;
    const groupProg = Math.min(1, (progress - group.startAt) / 0.2);
    const visiblePetals = Math.floor(groupProg * group.count);

    for (let i = 0; i < visiblePetals; i++) {
      const angle = (i / group.count) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, -group.r, group.rx, group.ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexToRgba(group.color, group.alpha);
      ctx.lineWidth = 1.0;
      ctx.stroke();
      ctx.restore();
    }
  });

  // Draw inner dots / ornaments
  if (progress > 0.85) {
    const dotProg = (progress - 0.85) / 0.15;
    const dotCount = 16;
    const dotR = maxR * 0.12;
    for (let i = 0; i < Math.floor(dotProg * dotCount); i++) {
      const angle = (i / dotCount) * Math.PI * 2;
      const x = cx + Math.cos(angle) * dotR;
      const y = cy + Math.sin(angle) * dotR;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba('#E88C3A', 0.6);
      ctx.fill();
    }
  }

  // Gently spinning outer decorative line
  if (progress > 0.2) {
    const spinAngle = progress * Math.PI * 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spinAngle);
    ctx.beginPath();
    ctx.arc(0, 0, maxR * 1.0, 0, Math.PI * 2 * Math.min(1, progress * 1.2));
    ctx.strokeStyle = 'rgba(232,168,74,0.12)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function canvasAnimationFrame(timestamp) {
  if (!canvasStart) canvasStart = timestamp;
  const elapsed  = timestamp - canvasStart;
  const progress = (elapsed % CANVAS_DURATION) / CANVAS_DURATION;

  const canvas = processCanvas;
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.width;
  const H      = canvas.height;

  drawMandalaCanvas(ctx, W, H, progress);

  canvasRaf = requestAnimationFrame(canvasAnimationFrame);
}

function startCanvasAnimation() {
  if (canvasRaf) return;
  canvasStart = null;
  canvasRaf   = requestAnimationFrame(canvasAnimationFrame);
}

function stopCanvasAnimation() {
  if (canvasRaf) {
    cancelAnimationFrame(canvasRaf);
    canvasRaf = null;
  }
}

// Start canvas animation when section enters viewport
const processSection = document.getElementById('process');
if (processSection) {
  const processObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (!processVideo.classList.contains('is-loaded') && canvasPlaying) {
          startCanvasAnimation();
        }
      } else {
        stopCanvasAnimation();
        canvasStart = null; // reset to start fresh next time
      }
    });
  }, { threshold: 0.1 });

  processObserver.observe(processSection);
}

/* ---------------------------------------------------------- */
/* 9. GENERATED IMAGES AUTO-GALLERY                            */
/* ---------------------------------------------------------- */

/* ── Gen Gallery REMOVED — replaced with teaser grid ────────────────── */
/* Original code commented out: gallery dynamically loaded 120 images  */
const genGrid_DISABLED = null;
if (false) { // DISABLED — gen-gallery section removed
const BOTANICAL_COUNT = 60;
const SWEAR_COUNT     = 60;
const TOTAL_COUNT     = BOTANICAL_COUNT + SWEAR_COUNT;

const genGrid          = document.getElementById('genGalleryGrid');
const genProgressFill  = document.getElementById('genProgressFill');
const genProgressLabel = document.getElementById('genProgressLabel');
const genTabs          = document.querySelectorAll('.gen-tab');

let genLoaded    = 0;
let activeTab    = 'botanical';

// Gallery images array for lightbox integration
let genGalleryImages = [];

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function buildGenGallery() {
  if (!genGrid) return;
  genGrid.innerHTML = '';
  genGalleryImages  = [];

  const allItems = [];

  // Build botanical list
  for (let i = 1; i <= BOTANICAL_COUNT; i++) {
    allItems.push({
      src:   `images/generated/botanical/botanical_${pad(i, 3)}.jpg`,
      alt:   `Botanical design ${i}`,
      label: 'Botanical',
      type:  'botanical',
      num:   i,
    });
  }

  // Build swear list
  for (let i = 1; i <= SWEAR_COUNT; i++) {
    allItems.push({
      src:   `images/generated/swear/swear_${pad(i, 3)}.jpg`,
      alt:   `Humor design ${i}`,
      label: 'Humor',
      type:  'swear',
      num:   i,
    });
  }

  // Render each item: try to load image, show placeholder if 404
  genLoaded = 0;
  let checked = 0;

  allItems.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'gen-gallery__item';
    wrapper.setAttribute('data-type', item.type);
    wrapper.style.setProperty('--reveal-delay', `${(idx % 8) * 0.05}s`);

    const tag = document.createElement('div');
    tag.className = 'gen-gallery__tag';
    tag.textContent = item.label;

    const overlay = document.createElement('div');
    overlay.className = 'inside__overlay';
    overlay.innerHTML = '<span>Click to view</span>';

    const img = document.createElement('img');
    img.alt   = item.alt;
    img.setAttribute('loading', 'lazy');

    wrapper.append(tag, img, overlay);

    // Try loading
    const testImg = new Image();
    testImg.onload = () => {
      img.src = item.src;
      img.classList.add('reveal-gen');
      genLoaded++;
      checked++;

      // Observe for grayscale-color reveal
      colorGenObserver.observe(img);

      // Add to gen gallery images for lightbox
      const galleryIdx = galleryImages.length + genGalleryImages.length;
      genGalleryImages.push({ src: item.src, alt: item.alt });
      wrapper.addEventListener('click', () => {
        // Merge and open
        const mergedGallery = [...galleryImages, ...genGalleryImages];
        const clickedIdx    = genGalleryImages.indexOf(genGalleryImages.find(g => g.src === item.src));
        openGenLightbox(genGalleryImages, clickedIdx);
      });

      updateProgress(checked);
    };

    testImg.onerror = () => {
      // Replace wrapper with placeholder
      wrapper.classList.add('gen-gallery__placeholder');
      wrapper.classList.remove('gen-gallery__item');
      wrapper.innerHTML = `<div class="gen-gallery__placeholder-label">Coming soon</div>`;
      wrapper.setAttribute('data-type', item.type);
      checked++;
      updateProgress(checked);
    };

    testImg.src = item.src;
    genGrid.appendChild(wrapper);
  });
}

// Separate lightbox opener for gen gallery
function openGenLightbox(images, startIndex) {
  const savedGallery = galleryImages.slice();
  galleryImages = images;
  openLightbox(startIndex);
  // Restore on close
  const restoreOnClose = () => {
    galleryImages = savedGallery;
    lightbox.removeEventListener('transitionend', restoreOnClose);
  };
  lightbox.addEventListener('transitionend', () => {
    if (!lightbox.classList.contains('is-open')) {
      galleryImages = savedGallery;
    }
  });
}

function updateProgress(checked) {
  const percent = (genLoaded / TOTAL_COUNT) * 100;
  if (genProgressFill)  genProgressFill.style.width  = `${percent}%`;
  if (genProgressLabel) genProgressLabel.textContent = `${genLoaded} of ${TOTAL_COUNT} images complete`;
}

// Grayscale-color for gen gallery
const colorGenObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img   = entry.target;
    const delay = Math.random() * 400;
    setTimeout(() => {
      img.classList.add('is-sepia');
      setTimeout(() => {
        img.classList.remove('is-sepia');
        img.classList.add('is-color');
      }, 800);
    }, delay);
    colorGenObserver.unobserve(img);
  });
}, { threshold: 0.15 });

// Tab filtering
genTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    genTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.getAttribute('data-tab');

    // Show/hide items
    genGrid.querySelectorAll('.gen-gallery__item, .gen-gallery__placeholder').forEach(el => {
      const type = el.getAttribute('data-type');
      if (activeTab === 'all') {
        el.removeAttribute('data-hidden');
      } else {
        el.setAttribute('data-hidden', type !== activeTab ? 'true' : 'false');
        if (type === activeTab) {
          el.removeAttribute('data-hidden');
        }
      }
    });
  });
});

// Build gen gallery when section enters viewport (lazy init)
const genSection = document.getElementById('gen-gallery');
if (genSection) {
  let genBuilt = false;
  const genInitObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !genBuilt) {
        genBuilt = true;
        buildGenGallery();
        genInitObserver.unobserve(genSection);
      }
    });
  }, { threshold: 0.05 });

  genInitObserver.observe(genSection);
}
} // END DISABLED gen-gallery block

/* ---------------------------------------------------------- */
/* 10. PROCESS SECTION — responsive canvas size                */
/* ---------------------------------------------------------- */

function resizeCanvas() {
  if (!processCanvas) return;
  const wrap = processCanvas.closest('.process__media');
  if (!wrap) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w > 0 && h > 0) {
    processCanvas.width  = w;
    processCanvas.height = h;
  }
}

window.addEventListener('resize', resizeCanvas, { passive: true });
resizeCanvas();

/* ---------------------------------------------------------- */
/* 11. SCROLL-TO-TOP BUTTON                                    */
/* ---------------------------------------------------------- */

const scrollTopBtn = document.getElementById('scrollTop');

if (scrollTopBtn) {
  window.addEventListener('scroll', () => {
    scrollTopBtn.classList.toggle('is-visible', window.scrollY > 300);
  }, { passive: true });

  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ── Books: Stacked Series → Spider Web Expand ──────────────────────── */
(function() {
  const stacks    = document.getElementById('seriesStacks');
  const spiderWeb = document.getElementById('spiderWeb');
  const spiderGrid = document.getElementById('spiderGrid');
  const spiderTitle = document.getElementById('spiderTitle');
  const backBtn    = document.getElementById('spiderBack');
  if (!stacks || !spiderWeb) return;

  // Load book data
  let bookData = {};
  try {
    bookData = JSON.parse(document.getElementById('bookData').textContent);
  } catch(e) { return; }

  const seriesNames = {
    'goodbye-stress': 'Goodbye Stress',
    'adult-relaxation': 'Adult Relaxation',
    'kids': 'Kids'
  };

  // Click a stack → expand to spider web
  document.querySelectorAll('.series-stack').forEach(stack => {
    stack.addEventListener('click', function() {
      const series = this.dataset.series;
      const books  = bookData[series];
      if (!books) return;

      spiderTitle.textContent = seriesNames[series] || series;
      spiderGrid.innerHTML = '';

      books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'spider-web__book';
        card.innerHTML = `
          <div class="spider-web__cover">
            <img src="${book.img}" alt="${book.title}" loading="lazy">
          </div>
          <div class="spider-web__info">
            <h4>${book.title}</h4>
            <p>${book.desc}</p>
            <a href="${book.url}" target="_blank" rel="noopener" class="btn btn--primary btn--sm">View on Amazon</a>
          </div>
        `;
        spiderGrid.appendChild(card);
      });

      stacks.style.display = 'none';
      spiderWeb.style.display = 'block';

      // Scroll to section
      spiderWeb.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Back button
  backBtn.addEventListener('click', function() {
    spiderWeb.style.display = 'none';
    stacks.style.display = 'flex';
  });

  // ESC to go back
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && spiderWeb.style.display !== 'none') {
      spiderWeb.style.display = 'none';
      stacks.style.display = 'flex';
    }
  });
})();

/* ── Click-to-Zoom for Peek Inside + Teaser Images ──────────────────── */
(function() {
  // Create zoom overlay
  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  overlay.innerHTML = '<img src="" alt="Zoomed view">';
  document.body.appendChild(overlay);

  const zoomImg = overlay.querySelector('img');

  // Click any .peek-img or .teaser-group__images img to zoom
  document.addEventListener('click', function(e) {
    const img = e.target.closest('.peek-img, .teaser-group__images img');
    if (!img) return;

    zoomImg.src = img.src;
    zoomImg.alt = img.alt || 'Zoomed coloring page';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  });

  // Click overlay or press ESC to close
  overlay.addEventListener('click', function() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  });
})();

/* ── In Motion: Series Row Arrows ───────────────────────────────────── */
(function() {
  const scrollAmount = 280;
  document.querySelectorAll('.series-row').forEach(row => {
    const track = row.querySelector('.series-row__track');
    const leftBtn = row.querySelector('.series-row__arrow--left');
    const rightBtn = row.querySelector('.series-row__arrow--right');
    if (!track) return;
    if (leftBtn) leftBtn.addEventListener('click', () => {
      track.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });
    if (rightBtn) rightBtn.addEventListener('click', () => {
      track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
  });
})();

/* ── Notify Me Modal (email capture for digital collections) ────────── */
(function() {
  const modal = document.getElementById('notifyModal');
  if (!modal) return;

  const backdrop = modal.querySelector('.notify-modal__backdrop');
  const closeBtn = modal.querySelector('.notify-modal__close');
  const form = document.getElementById('notifyForm');
  const emailInput = document.getElementById('notifyEmail');
  const collectionInput = document.getElementById('notifyCollection');
  const collectionName = document.getElementById('notifyCollectionName');
  const successMsg = document.getElementById('notifySuccess');

  const collectionLabels = {
    'dark-botanicals': 'Dark Botanicals',
    'cottage-garden': 'Cottage Garden',
    'tropical-exotic': 'Tropical & Exotic',
    'mushroom-forest': 'Mushroom Forest',
    'pressed-flower': 'Pressed Flower',
    'cat-sass': 'Cat Sass',
    'garden-humor': 'Garden Humor',
    'monday-mood': 'Monday Mood',
    'wellness-chaos': 'Wellness Chaos',
    'wine-unwind': 'Wine & Unwind'
  };

  function openModal(collection) {
    collectionInput.value = collection;
    collectionName.textContent = collectionLabels[collection] || collection;
    form.style.display = 'flex';
    successMsg.style.display = 'none';
    emailInput.value = '';
    modal.style.display = 'block';
    emailInput.focus();
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  document.querySelectorAll('.btn--notify').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.collection));
  });

  backdrop.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.style.display === 'block') closeModal();
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const collection = collectionInput.value;
    if (!email) return;

    // Store locally (localStorage) until a backend is wired up
    const subs = JSON.parse(localStorage.getItem('pp_notify_subs') || '[]');
    subs.push({ email, collection, ts: Date.now() });
    localStorage.setItem('pp_notify_subs', JSON.stringify(subs));

    form.style.display = 'none';
    successMsg.style.display = 'block';

    // Also swap the clicked button text
    const btn = document.querySelector(`.btn--notify[data-collection="${collection}"]`);
    if (btn) {
      btn.textContent = '✓ Subscribed';
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }

    setTimeout(closeModal, 2000);
  });
})();

/* ── FAQ structured data (SEO) ──────────────────────────────────────── */
(function() {
  const faqItems = document.querySelectorAll('.faq__item');
  if (!faqItems.length) return;

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: Array.from(faqItems).map(item => ({
      '@type': 'Question',
      name: item.querySelector('.faq__question').textContent.trim(),
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.querySelector('.faq__answer').textContent.trim()
      }
    }))
  };

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(faqSchema);
  document.head.appendChild(script);
})();

/* =========================================================
   T13 — CART DRAWER (skeleton open/close + count badge)
   T7 will wire real add-to-cart, line items, and checkout.
   ========================================================= */
(function cartDrawerSkeleton() {
  const drawer = document.getElementById('cartDrawer');
  if (!drawer) return;

  const openers = document.querySelectorAll('[data-cart-open]');
  const closers = drawer.querySelectorAll('[data-cart-close]');
  const countEl = document.querySelector('[data-cart-count]');

  function open() {
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  openers.forEach((b) => b.addEventListener('click', open));
  closers.forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) close();
  });

  // Expose a tiny hook so T7 (or any future logic) can update the badge
  // without re-implementing it. window.PaniniCart.setCount(n) — that's it.
  window.PaniniCart = window.PaniniCart || {};
  window.PaniniCart.setCount = function (n) {
    if (!countEl) return;
    const v = Math.max(0, parseInt(n, 10) || 0);
    countEl.textContent = String(v);
    countEl.classList.toggle('is-active', v > 0);
  };
  window.PaniniCart.open = open;
  window.PaniniCart.close = close;

  // Initial state
  window.PaniniCart.setCount(0);
})();

/* =========================================================
   T7 — SIZE PICKER (chip toggle; explainer only, no SKU swap)
   ========================================================= */
(function paniniSizePicker() {
  document.querySelectorAll('[data-size-picker]').forEach((picker) => {
    const chips = Array.from(picker.querySelectorAll('.size-picker__chip'));
    if (!chips.length) return;
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => {
          c.classList.remove('is-active');
          c.setAttribute('aria-checked', 'false');
        });
        chip.classList.add('is-active');
        chip.setAttribute('aria-checked', 'true');
      });
    });
  });
})();

/* =========================================================
   T7 — CART LOGIC (server-side via /api, graceful fallback)

   Talks to the Forge server when /api is mounted (prod / dev:server).
   Falls back to a non-blocking notice when served from the flat
   static serve.js (no /api). Builds on top of the T13 drawer hook:
     window.PaniniCart.{setCount,open,close} — already in place.
   ========================================================= */
(function paniniCartCommerce() {
  if (!window.PaniniCart) return; // T13 hook missing — bail silently

  const API_BASE = '/api';
  const CART_ID_KEY = 'pp_cart_id';      // mirror the httpOnly cookie locally
  const NOTICE_KEY  = 'pp_cart_offline_noticed';

  const drawer       = document.getElementById('cartDrawer');
  const itemsRoot    = drawer && drawer.querySelector('[data-cart-items]');
  const subtotalEl   = drawer && drawer.querySelector('[data-cart-subtotal]');
  const checkoutBtn  = drawer && drawer.querySelector('[data-cart-checkout]');
  if (!drawer || !itemsRoot || !subtotalEl || !checkoutBtn) return;

  // ----- helpers ----------------------------------------------------------
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (cents, currency = 'USD') => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
    } catch {
      return '$' + ((cents || 0) / 100).toFixed(2);
    }
  };

  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      ...opts,
    });
    if (!res.ok) {
      const err = new Error('api_error');
      err.status = res.status;
      try { err.body = await res.json(); } catch { /* noop */ }
      throw err;
    }
    return res.json();
  }

  // Local cart-id mirror — server uses an httpOnly cookie, but JS can't read
  // it, and we want to GET /api/cart/:id on page load. Storing the id in
  // localStorage is harmless (the cookie remains the source of trust).
  function getCartId() { try { return localStorage.getItem(CART_ID_KEY) || null; } catch { return null; } }
  function setCartId(id) { try { id ? localStorage.setItem(CART_ID_KEY, id) : localStorage.removeItem(CART_ID_KEY); } catch { /* noop */ } }

  // ----- state ------------------------------------------------------------
  let state = {
    cart: null,           // serialized cart from server, or null
    offline: false,       // true once we detect /api isn't reachable
  };

  // ----- rendering --------------------------------------------------------
  function renderEmpty() {
    itemsRoot.innerHTML = '<p class="cart-drawer__empty">Your cart is empty.</p>';
    subtotalEl.textContent = fmtMoney(0);
    checkoutBtn.disabled = true;
    window.PaniniCart.setCount(0);
  }

  function renderCart(cart) {
    if (!cart || !cart.items || cart.items.length === 0) {
      renderEmpty();
      return;
    }
    const html = cart.items.map((it) => {
      const slug = it.bundleSlug || '';
      // Bundle covers live at /images/bundles/<slug>/cover.png — works from
      // any page depth because we lead with '/'.
      const cover = slug ? `/images/bundles/${slug}/cover.png` : '';
      return `
        <article class="cart-line" data-cart-line data-item-id="${it.id}">
          <div class="cart-line__media">
            ${cover ? `<img src="${cover}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          </div>
          <div class="cart-line__body">
            <h3 class="cart-line__title">${escapeHtml(it.bundleTitle || 'Bundle')}</h3>
            <p class="cart-line__meta">Qty ${it.quantity} &middot; ${fmtMoney(it.unitPriceCents, it.currency)} each</p>
          </div>
          <div class="cart-line__side">
            <span class="cart-line__price">${fmtMoney(it.lineTotalCents, it.currency)}</span>
            <button type="button" class="cart-line__remove" data-cart-remove="${it.id}" aria-label="Remove ${escapeHtml(it.bundleTitle || 'item')} from cart">Remove</button>
          </div>
        </article>
      `;
    }).join('');
    itemsRoot.innerHTML = html;
    subtotalEl.textContent = fmtMoney(cart.totalCents, cart.currency);
    checkoutBtn.disabled = false;
    const totalQty = cart.items.reduce((s, i) => s + (i.quantity || 0), 0);
    window.PaniniCart.setCount(totalQty);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ----- offline / no-API fallback ---------------------------------------
  function showOfflineNotice(message) {
    // One-shot, non-blocking. Lives inside the drawer body so the rest of
    // the page stays calm.
    itemsRoot.innerHTML = `
      <div class="cart-drawer__notice" role="status">
        <strong>Cart available on the live store.</strong>
        <p>${escapeHtml(message || 'This preview build is static — checkout opens on the live deployment.')}</p>
      </div>`;
    subtotalEl.textContent = fmtMoney(0);
    checkoutBtn.disabled = true;
  }

  function goOffline(reason) {
    state.offline = true;
    showOfflineNotice(reason);
    // Don't badge a fake count, but don't reset existing badge either if the
    // user managed to add things server-side earlier in the session.
  }

  // ----- actions ----------------------------------------------------------
  async function ensureCart() {
    let id = getCartId();
    if (id) {
      try {
        const cart = await api(`/cart/${encodeURIComponent(id)}`);
        state.cart = cart;
        return cart;
      } catch (err) {
        // 404 → cookie/local id stale. Anything else → bubble up.
        if (err.status === 404) {
          setCartId(null);
        } else {
          throw err;
        }
      }
    }
    const cart = await api('/cart', { method: 'POST' });
    setCartId(cart.id);
    state.cart = cart;
    return cart;
  }

  async function addToCart(slug, qty = 1) {
    const cart = await ensureCart();
    // Flag #2 guard (T11): one bundle per checkout. The server's checkout
    // endpoint returns 501 on multi-bundle carts; we block it here so that
    // backstop never fires for a real shopper. Same-slug re-adds (quantity
    // bumps) pass through — only a DISTINCT second bundle is blocked.
    if (cart && Array.isArray(cart.items) && cart.items.length > 0) {
      const hasDifferentBundle = cart.items.some((it) => it.bundleSlug && it.bundleSlug !== slug);
      if (hasDifferentBundle) {
        renderCart(cart);
        showBundleLimitNote();
        window.PaniniCart.open();
        return cart;
      }
    }
    const updated = await api(`/cart/${encodeURIComponent(cart.id)}/items`, {
      method: 'POST',
      body: JSON.stringify({ bundleSlug: slug, quantity: qty }),
    });
    state.cart = updated;
    renderCart(updated);
    window.PaniniCart.open();
    return updated;
  }

  // Inline drawer note for the one-bundle-per-checkout guard. Calm, dismissible,
  // auto-clears after 6s. Sits ABOVE existing line items so the user's
  // current bundle stays visible — they don't lose work.
  function showBundleLimitNote() {
    // Avoid stacking duplicates if the shopper clicks add a few times.
    const existing = itemsRoot.querySelector('[data-bundle-limit-note]');
    if (existing) existing.remove();
    const note = document.createElement('div');
    note.className = 'cart-drawer__notice';
    note.setAttribute('role', 'status');
    note.setAttribute('data-bundle-limit-note', '');
    note.innerHTML = `<strong>One bundle per order for now.</strong><p>We'll add multi-bundle checkout soon — for now, finish this one and grab the next on a fresh order.</p>`;
    itemsRoot.prepend(note);
    setTimeout(() => { if (note.parentNode) note.remove(); }, 6000);
  }

  async function removeFromCart(itemId) {
    if (!state.cart) return;
    const updated = await api(`/cart/${encodeURIComponent(state.cart.id)}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    });
    state.cart = updated;
    renderCart(updated);
  }

  async function checkout() {
    if (!state.cart || !state.cart.items || state.cart.items.length === 0) return;
    checkoutBtn.disabled = true;
    const originalLabel = checkoutBtn.textContent;
    checkoutBtn.textContent = 'Opening checkout…';
    try {
      const order = await api(`/cart/${encodeURIComponent(state.cart.id)}/checkout`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      // Whop hand-off — env-gated. Stub returns { url } when not configured;
      // a 501 means multi-bundle (or similar) isn't supported yet.
      try {
        const session = await api('/checkout/whop', {
          method: 'POST',
          body: JSON.stringify({ orderId: order.orderId }),
        });
        if (session && session.url) {
          window.location.href = session.url;
          return;
        }
        throw new Error('no_url');
      } catch (whopErr) {
        // Order is created (status=pending) but Whop isn't wired. Surface a
        // graceful "coming soon" state — do NOT hard-error the UI.
        renderCheckoutComingSoon(order.orderId);
      }
    } catch (err) {
      renderCheckoutError(err);
    } finally {
      checkoutBtn.textContent = originalLabel;
    }
  }

  function renderCheckoutComingSoon(orderId) {
    itemsRoot.innerHTML = `
      <div class="cart-drawer__notice" role="status">
        <strong>Checkout opens soon.</strong>
        <p>Your order is reserved (ref <code>${escapeHtml(String(orderId).slice(0, 8))}</code>). Payment goes live with the next deploy — we'll email a download link the moment it does.</p>
      </div>`;
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Coming soon';
  }

  function renderCheckoutError(err) {
    const msg = (err && err.body && err.body.message) || 'Something hiccupped. Try again in a moment.';
    // Keep the cart visible underneath the toast so the user doesn't feel
    // like they lost work.
    const toast = document.createElement('div');
    toast.className = 'cart-drawer__notice cart-drawer__notice--error';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<strong>Couldn't reach checkout.</strong><p>${escapeHtml(msg)}</p>`;
    itemsRoot.prepend(toast);
    setTimeout(() => toast.remove(), 6000);
    checkoutBtn.disabled = false;
  }

  // ----- wire up DOM ------------------------------------------------------
  // Add-to-cart buttons live on every page (store cards + 2 detail pages).
  // Some shipped with `disabled` from T13 — enable them now that logic
  // exists. (We re-check before each click so server-down state can disable.)
  $$('[data-cart-add]').forEach((btn) => {
    btn.disabled = false;
    btn.removeAttribute('aria-label'); // T13 placeholder a11y label no longer accurate
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const slug = btn.getAttribute('data-bundle-slug');
      if (!slug) return;
      if (state.offline) {
        window.PaniniCart.open();
        return;
      }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Adding…';
      try {
        await addToCart(slug, 1);
        btn.textContent = 'Added';
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
      } catch (err) {
        // First add failing usually means no /api at all (flat static serve).
        if (err.status === undefined || err.message === 'Failed to fetch') {
          goOffline();
          window.PaniniCart.open();
        } else {
          btn.textContent = 'Try again';
          setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
        }
      }
    });
  });

  // Buy-now: same as add + immediately try checkout
  $$('[data-buy-now]').forEach((btn) => {
    btn.disabled = false;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const slug = btn.getAttribute('data-bundle-slug');
      if (!slug) return;
      if (state.offline) { window.PaniniCart.open(); return; }
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Loading…';
      try {
        await addToCart(slug, 1);
        await checkout();
      } catch (err) {
        if (err.status === undefined) { goOffline(); window.PaniniCart.open(); }
      } finally {
        btn.textContent = original;
        btn.disabled = false;
      }
    });
  });

  // Remove (event-delegated — items re-render on every change)
  itemsRoot.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-cart-remove]');
    if (!removeBtn) return;
    const itemId = removeBtn.getAttribute('data-cart-remove');
    if (!itemId) return;
    removeBtn.disabled = true;
    removeFromCart(itemId).catch(() => { removeBtn.disabled = false; });
  });

  checkoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    checkout();
  });

  // ----- boot: rehydrate cart if we have an id ----------------------------
  (async function boot() {
    const id = getCartId();
    if (!id) {
      // Nothing to load — just confirm /api is reachable before promising
      // anything. We do a tiny probe only on pages that have cart buttons.
      if (!$$('[data-cart-add]').length) return;
      try {
        // Cheap probe: HEAD-equivalent via a known cheap GET.
        await fetch(API_BASE + '/bundles', { credentials: 'same-origin' }).then((r) => {
          if (!r.ok) throw new Error('probe_failed');
        });
      } catch {
        goOffline();
      }
      return;
    }
    try {
      const cart = await api(`/cart/${encodeURIComponent(id)}`);
      state.cart = cart;
      renderCart(cart);
    } catch (err) {
      if (err.status === 404) {
        setCartId(null);
        renderEmpty();
      } else {
        goOffline();
      }
    }
  })();
})();
