// Nexus Analytics Dashboard - Professional Enterprise Mock
// Built by Kimi K2.5

(function() {
    'use strict';

    // ===== Utility Functions =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    function lerp(start, end, t) {
        return start * (1 - t) + end * t;
    }

    function easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    function formatNumber(num, prefix = '', suffix = '') {
        return prefix + num.toLocaleString('en-US', { minimumFractionDigits: num % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 }) + suffix;
    }

    // ===== Animated Counter =====
    class AnimatedCounter {
        constructor(element, target, duration = 2000, prefix = '', suffix = '') {
            this.element = element;
            this.target = parseFloat(target);
            this.duration = duration;
            this.prefix = prefix;
            this.suffix = suffix;
            this.isDecimal = this.target % 1 !== 0;
            this.startTime = null;
            this.observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    this.start();
                    this.observer.disconnect();
                }
            });
            this.observer.observe(element);
        }

        start() {
            this.startTime = performance.now();
            requestAnimationFrame((t) => this.animate(t));
        }

        animate(currentTime) {
            const elapsed = currentTime - this.startTime;
            const progress = Math.min(elapsed / this.duration, 1);
            const eased = easeOutQuart(progress);
            const current = lerp(0, this.target, eased);

            if (this.isDecimal) {
                this.element.textContent = this.prefix + current.toFixed(2) + this.suffix;
            } else {
                this.element.textContent = this.prefix + Math.floor(current).toLocaleString() + this.suffix;
            }

            if (progress < 1) {
                requestAnimationFrame((t) => this.animate(t));
            }
        }
    }

    // ===== Revenue Bar Chart =====
    function drawRevenueChart() {
        const canvas = document.getElementById('revenueChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 20, right: 20, bottom: 50, left: 60 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const data = [32000, 28000, 45000, 38000, 52000, 48000, 61000, 55000, 67000, 72000, 68000, 82000];
        const maxVal = Math.max(...data) * 1.1;

        // Animation state
        let animProgress = 0;
        const animDuration = 1500;
        const startTime = performance.now();

        function render(now) {
            animProgress = Math.min((now - startTime) / animDuration, 1);
            const eased = easeOutQuart(animProgress);

            ctx.clearRect(0, 0, width, height);

            // Grid lines
            const gridLines = 5;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= gridLines; i++) {
                const y = padding.top + (chartH / gridLines) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels
                const value = maxVal - (maxVal / gridLines) * i;
                ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText('$' + (value / 1000).toFixed(0) + 'k', padding.left - 12, y + 4);
            }

            // Bars
            const barCount = data.length;
            const barSpacing = chartW / barCount;
            const barWidth = barSpacing * 0.55;

            data.forEach((val, i) => {
                const barHeight = (val / maxVal) * chartH * eased;
                const x = padding.left + barSpacing * i + (barSpacing - barWidth) / 2;
                const y = padding.top + chartH - barHeight;

                // Bar gradient
                const grad = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
                grad.addColorStop(0, 'rgba(99, 102, 241, 0.9)');
                grad.addColorStop(0.5, 'rgba(139, 92, 246, 0.6)');
                grad.addColorStop(1, 'rgba(139, 92, 246, 0.1)');

                // Rounded top bar
                const radius = 6;
                ctx.beginPath();
                ctx.moveTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.lineTo(x + barWidth - radius, y);
                ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
                ctx.lineTo(x + barWidth, padding.top + chartH);
                ctx.lineTo(x, padding.top + chartH);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();

                // Glow effect on top
                if (eased > 0.5) {
                    ctx.beginPath();
                    ctx.arc(x + barWidth / 2, y, 4, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
                    ctx.fill();
                }

                // X labels
                ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
                ctx.font = '12px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(months[i], x + barWidth / 2, padding.top + chartH + 22);
            });

            if (animProgress < 1) {
                requestAnimationFrame(render);
            }
        }

        requestAnimationFrame(render);
    }

    // ===== Doughnut Chart =====
    function drawDoughnutChart() {
        const canvas = document.getElementById('sourceChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const radius = Math.min(centerX, centerY) - 20;
        const innerRadius = radius * 0.65;

        const segments = [
            { value: 42, color: '#6366F1' },
            { value: 28, color: '#8B5CF6' },
            { value: 18, color: '#06B6D4' },
            { value: 12, color: '#10B981' }
        ];

        let animProgress = 0;
        const animDuration = 1200;
        const startTime = performance.now();

        function render(now) {
            animProgress = Math.min((now - startTime) / animDuration, 1);
            const eased = easeOutQuart(animProgress);

            ctx.clearRect(0, 0, rect.width, rect.height);

            let currentAngle = -Math.PI / 2;
            const total = segments.reduce((a, b) => a + b.value, 0);

            segments.forEach((seg, i) => {
                const sliceAngle = (seg.value / total) * Math.PI * 2 * eased;

                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
                ctx.arc(centerX, centerY, innerRadius, currentAngle + sliceAngle, currentAngle, true);
                ctx.closePath();
                ctx.fillStyle = seg.color;
                ctx.fill();

                // Segment border/gap
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
                ctx.lineWidth = 3;
                ctx.stroke();

                currentAngle += sliceAngle;
            });

            // Center text
            if (eased > 0.5) {
                const centerFade = Math.min((eased - 0.5) * 4, 1);
                ctx.fillStyle = `rgba(241, 245, 249, ${centerFade})`;
                ctx.font = 'bold 28px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('100%', centerX, centerY - 8);

                ctx.fillStyle = `rgba(148, 163, 184, ${centerFade})`;
                ctx.font = '12px Inter, sans-serif';
                ctx.fillText('Traffic', centerX, centerY + 14);
            }

            if (animProgress < 1) {
                requestAnimationFrame(render);
            }
        }

        requestAnimationFrame(render);
    }

    // ===== Sparkline Charts =====
    function drawSparkline(elementId, color, data) {
        const container = document.getElementById(elementId);
        if (!container) return;

        const canvas = document.createElement('canvas');
        canvas.width = container.offsetWidth || 200;
        canvas.height = 50;
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);

        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;
        const maxVal = Math.max(...data);
        const minVal = Math.min(...data);
        const range = maxVal - minVal || 1;

        const points = data.map((val, i) => ({
            x: (i / (data.length - 1)) * width,
            y: height - ((val - minVal) / range) * (height - 10) - 5
        }));

        // Area gradient
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
        grad.addColorStop(1, color.replace(')', ', 0)').replace('rgb', 'rgba'));

        ctx.beginPath();
        ctx.moveTo(points[0].x, height);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, height);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    // ===== Live Activity Simulator =====
    class ActivitySimulator {
        constructor() {
            this.list = document.getElementById('activityList');
            this.activities = [
                { text: 'New order <strong>#ORD-{id}</strong> completed', type: 'success', time: 'Just now' },
                { text: '<strong>{name}</strong> signed up', type: 'user', time: 'Just now' },
                { text: 'Payment received <strong>${amount}</strong>', type: 'payment', time: 'Just now' },
                { text: 'Server load at <strong>{load}%</strong>', type: 'warning', time: 'Just now' },
                { text: 'New order <strong>#ORD-{id}</strong> placed', type: 'success', time: 'Just now' },
                { text: '<strong>{name}</strong> upgraded to Pro', type: 'payment', time: 'Just now' },
                { text: 'API response time <strong>{ms}ms</strong>', type: 'warning', time: 'Just now' },
            ];
            this.names = ['Alice Chen', 'Bob Martinez', 'Carol Williams', 'David Kim', 'Emma Thompson', 'Frank Lee', 'Grace Park'];
            this.icons = {
                success: { bg: 'rgba(16, 185, 129, 0.12)', color: '#10B981', svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' },
                user: { bg: 'rgba(99, 102, 241, 0.12)', color: '#6366F1', svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
                payment: { bg: 'rgba(6, 182, 212, 0.12)', color: '#06B6D4', svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
                warning: { bg: 'rgba(245, 158, 11, 0.12)', color: '#F59E0B', svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' }
            };
            this.start();
        }

        generateActivity() {
            const template = this.activities[Math.floor(Math.random() * this.activities.length)];
            const id = Math.floor(7843 + Math.random() * 100);
            const name = this.names[Math.floor(Math.random() * this.names.length)];
            const amount = Math.floor(29 + Math.random() * 1500);
            const load = Math.floor(60 + Math.random() * 35);
            const ms = Math.floor(20 + Math.random() * 180);

            let text = template.text
                .replace('{id}', id)
                .replace('{name}', name)
                .replace('{amount}', amount.toLocaleString())
                .replace('{load}', load)
                .replace('{ms}', ms);

            return { text, type: template.type };
        }

        addActivity() {
            const activity = this.generateActivity();
            const icon = this.icons[activity.type];

            const item = document.createElement('div');
            item.className = 'activity-item';
            item.style.animation = 'activitySlide 0.4s ease forwards';
            item.innerHTML = `
                <div class="activity-icon" style="background:${icon.bg};color:${icon.color}">${icon.svg}</div>
                <div class="activity-content">
                    <p class="activity-text">${activity.text}</p>
                    <span class="activity-time">Just now</span>
                </div>
            `;

            this.list.insertBefore(item, this.list.firstChild);

            if (this.list.children.length > 6) {
                const last = this.list.lastChild;
                last.style.animation = 'none';
                last.style.opacity = '0';
                last.style.transform = 'translateX(20px)';
                setTimeout(() => last.remove(), 300);
            }
        }

        start() {
            setInterval(() => this.addActivity(), 5000);
        }
    }

    // ===== Real-time Data Updates =====
    class RealtimeUpdater {
        constructor() {
            this.cards = [
                { id: 'total-users', target: 12450, variance: 50 },
                { id: 'revenue', target: 54321, variance: 500, prefix: '$' },
                { id: 'orders', target: 1234, variance: 10 },
                { id: 'conversion', target: 3.45, variance: 0.1, suffix: '%' }
            ];
            this.start();
        }

        update() {
            this.cards.forEach(card => {
                const el = document.getElementById(card.id);
                if (!el) return;
                const variation = (Math.random() - 0.5) * card.variance * 2;
                const newVal = card.target + variation;
                if (card.suffix === '%') {
                    el.textContent = (card.prefix || '') + newVal.toFixed(2) + card.suffix;
                } else {
                    el.textContent = (card.prefix || '') + Math.floor(newVal).toLocaleString() + (card.suffix || '');
                }
            });
        }

        start() {
            setInterval(() => this.update(), 4000);
        }
    }

    // ===== Interactive Effects =====
    function initInteractiveEffects() {
        // Filter buttons
        $$('.filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                this.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                // Redraw chart with animation
                drawRevenueChart();
            });
        });

        // Nav items
        $$('.nav-item').forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                $$('.nav-item').forEach(n => n.classList.remove('active'));
                this.classList.add('active');
            });
        });
    }

    // ===== Canvas Resize Handler =====
    function initResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Clear sparklines and redraw
                $$('.kpi-sparkline canvas').forEach(c => c.remove());
                drawAllSparklines();
                drawRevenueChart();
                drawDoughnutChart();
            }, 250);
        });
    }

    function drawAllSparklines() {
        drawSparkline('spark1', 'rgb(99, 102, 241)', [30, 45, 35, 50, 40, 60, 55, 70, 65, 80, 75, 90]);
        drawSparkline('spark2', 'rgb(16, 185, 129)', [40, 55, 45, 60, 50, 65, 60, 75, 70, 85, 80, 95]);
        drawSparkline('spark3', 'rgb(6, 182, 212)', [50, 40, 55, 45, 60, 50, 55, 45, 50, 40, 45, 35]);
        drawSparkline('spark4', 'rgb(244, 63, 94)', [20, 30, 25, 35, 30, 40, 35, 45, 40, 50, 45, 55]);
    }

    // ===== Initialize Everything =====
    function init() {
        // Animated counters
        $$('.kpi-value').forEach(el => {
            const target = parseFloat(el.dataset.target);
            const prefix = el.dataset.prefix || '';
            const suffix = el.dataset.suffix || '';
            new AnimatedCounter(el, target, 2000, prefix, suffix);
        });

        // Charts
        drawRevenueChart();
        drawDoughnutChart();
        drawAllSparklines();

        // Simulators
        new ActivitySimulator();
        new RealtimeUpdater();

        // Interactions
        initInteractiveEffects();
        initResizeHandler();
    }

    // Start on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
