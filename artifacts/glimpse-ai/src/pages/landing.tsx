import React, { useState, useRef, useEffect, useCallback, MouseEvent } from "react";
import { Link } from "wouter";
import { Sparkles, Wand2, ArrowRight, Star, PlayCircle, Zap, Image as ImageIcon, Users, ImageUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence, useInView } from "framer-motion";

// --- Animation presets ---
const ease = [0.16, 1, 0.3, 1] as const;

function RevealOnScroll({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 }}
      transition={{ duration: 0.7, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- Rotating Words ---
const rotatingWords = ["Cinematic", "Stunning", "Effortless", "Pro-grade", "Instant", "Creative", "AI-Powered"];

function RotatingWord() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((p) => (p + 1) % rotatingWords.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex h-[1.15em] overflow-hidden align-bottom relative min-w-[140px] md:min-w-[220px] justify-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={rotatingWords[index]}
          initial={{ y: "110%", opacity: 0, rotateX: -45 }}
          animate={{ y: "0%", opacity: 1, rotateX: 0 }}
          exit={{ y: "-110%", opacity: 0, rotateX: 45 }}
          transition={{ duration: 0.5, ease }}
          className="absolute bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent font-bold"
        >
          {rotatingWords[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// --- Testimonials Data ---
const testimonials = [
  {
    quote: "GlimpseAI completely replaced my complex editing workflow. What used to take hours now takes seconds.",
    name: "Sarah Jenkins",
    role: "Professional Photographer",
  },
  {
    quote: "The AI upscaling is mind-blowing. I recovered detail from old photos I thought were lost forever.",
    name: "Marcus Chen",
    role: "Content Creator",
  },
  {
    quote: "Our marketing team switched to GlimpseAI. The cinematic color grading saved us thousands in post-production.",
    name: "Elena Rodriguez",
    role: "Marketing Director",
  },
  {
    quote: "I've tested every AI editor on the market. GlimpseAI consistently delivers professional-quality results.",
    name: "David Park",
    role: "Film Editor",
  },
  {
    quote: "From raw footage to polished content in under a minute. GlimpseAI is the tool I can't live without.",
    name: "Priya Sharma",
    role: "YouTube Creator",
  },
];

// --- Name-to-gender detection ---
// First-name lookup tables covering common Western, South Asian, East Asian, and Arabic names.
const FEMALE_FIRST_NAMES = new Set([
  "sarah","elena","priya","maria","anna","emma","lily","sophia","olivia","ava",
  "isabella","mia","charlotte","amelia","harper","evelyn","abigail","emily",
  "elizabeth","mila","ella","scarlett","grace","victoria","riley","aria","zoe",
  "nora","hannah","layla","ellie","chloe","penelope","luna","natalie",
  "aubrey","claire","ruby","stella","leah","hazel","savannah","camila",
  "aisha","fatima","nadia","yasmin","amira","leilani","aaliya","zara","farah",
  "neha","meena","sunita","divya","kavya","shreya","pooja","anjali","nisha",
  "deepa","lakshmi","geeta","rekha","sandhya","asha","radha",
  "valeria","sofia","valentina","martina","carolina","luisa",
  "jessica","jennifer","ashley","amanda","stephanie","michelle","melissa",
  "nicole","samantha","laura","patricia","linda","barbara","karen","lisa",
  "nancy","margaret","ruth","sharon","rachel","sara","kelly","jane","andrea",
  "paula","rebecca","amy","helen","angela","diana","nina","rose","sue",
  "gloria","judy","virginia","diane","cynthia","lillian","denise","marie",
  "theresa","wanda","vera","shirley","anita","cheryl","lorraine","irene",
  "katrina","gina","penny","tiffany","crystal","brenda","wendy","jacqueline",
  "amber","dana","robin","kim","stacy","tammy","tamara","lindsey","tracy",
  "kathleen","katharine","kathryn","ann","alice","sandra","carol","marilyn",
  "xu","wei","fang","xiu","ying","lin","ping","yan","qian","jing",
  "ayesha","lina","rima","hana","nour","dina","mona","rania",
  "yuki","sakura","hana","yui","akemi","haruka","mai","rin",
]);

const MALE_FIRST_NAMES = new Set([
  "marcus","david","james","john","robert","michael","william","richard","joseph",
  "charles","thomas","daniel","matthew","george","donald","anthony","steven","mark",
  "paul","andrew","kenneth","joshua","kevin","brian","timothy","ronald","edward",
  "jason","jeffrey","ryan","jacob","gary","nicholas","eric","jonathan","stephen",
  "larry","justin","scott","brandon","benjamin","samuel","raymond","frank",
  "alexander","christopher","patrick","jack","dennis","jerry","tyler","aaron",
  "jose","adam","henry","douglas","nathan","peter","zachary","kyle","walter",
  "ethan","jeremy","harold","carl","arthur","keith","roger","terry","sean",
  "gerald","austin","alan","juan","xavier","albert","wayne",
  "liam","noah","oliver","elijah","lucas","mason","logan","caleb","dylan",
  "hunter","jordan","owen","luke","landon","brayden","gabriel","julian","evan",
  "carter","wyatt","lincoln","eli","ian","aidan",
  "raj","rahul","arjun","vikram","suresh","mahesh","ramesh","vijay","ajay",
  "sanjay","ankur","ravi","amit","rohit","nikhil","ankit","gaurav","kunal",
  "vivek","manish","rohan","karan","aarav","ishaan",
  "carlos","miguel","antonio","alejandro","jorge","rodrigo","martin","pedro","fernando",
  "wei","ming","hao","jian","bo","cheng","lei","zhang",
  "omar","ali","hassan","ahmed","khalid","ibrahim","yusuf","tariq","kareem",
  "hiroshi","takashi","kenji","daisuke","satoshi","taro","riku","hayato","ken",
]);

/** Returns 'female', 'male', or 'neutral' based on the first name. */
function detectGender(firstName: string): "female" | "male" | "neutral" {
  const key = firstName.toLowerCase().trim();
  if (FEMALE_FIRST_NAMES.has(key)) return "female";
  if (MALE_FIRST_NAMES.has(key)) return "male";
  return "neutral";
}

/**
 * Deterministic 0–98 integer from any string.
 * Used to select a stable portrait index from the randomuser.me CDN.
 */
function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 99;
}

/**
 * Primary portrait URL — randomuser.me free CDN of AI-generated faces.
 * URLs are stable (e.g. /portraits/women/44.jpg) and served at 128×128px.
 */
function getPortraitUrl(fullName: string): string {
  const firstName = fullName.split(" ")[0];
  const gender = detectGender(firstName);
  const folder = gender === "female" ? "women" : "men";
  const index = nameHash(fullName);
  return `https://randomuser.me/api/portraits/${folder}/${index}.jpg`;
}

/**
 * Fallback URL — DiceBear Notionists SVG avatar.
 * Rendered if the primary photo fails to load (e.g., offline / CDN unreachable).
 */
function getFallbackAvatarUrl(fullName: string): string {
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(fullName)}&backgroundColor=27272a`;
}

// --- Testimonial Avatar with loading skeleton + error fallback ---
function TestimonialAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const [src, setSrc] = useState(() => getPortraitUrl(name));
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className="relative rounded-full overflow-hidden flex-shrink-0 border-2 border-teal-500/40 ring-2 ring-teal-500/10 bg-zinc-800"
      style={{ width: size, height: size }}
    >
      {/* Loading skeleton */}
      {!loaded && (
        <div className="absolute inset-0 bg-zinc-700 animate-pulse" />
      )}
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        decoding="async"
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          // Switch to DiceBear fallback on network/CDN error
          setSrc(getFallbackAvatarUrl(name));
          setLoaded(true);
        }}
      />
    </div>
  );
}

// --- Testimonial Carousel ---
function TestimonialCarousel() {
  const [current, setCurrent] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const advance = useCallback(() => {
    setCurrent((p) => (p + 1) % testimonials.length);
  }, []);

  useEffect(() => {
    timeoutRef.current = setTimeout(advance, 5000);
    return () => clearTimeout(timeoutRef.current);
  }, [current, advance]);

  return (
    <div className="max-w-4xl mx-auto text-center">
      <div className="flex justify-center gap-1 mb-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className="w-5 h-5 fill-teal-500 text-teal-500" />
        ))}
      </div>

      <div className="relative h-[180px] md:h-[160px] flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0, x: 50, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -50, filter: "blur(4px)" }}
            transition={{ duration: 0.5, ease }}
            className="absolute inset-0 flex flex-col items-center justify-center px-4"
          >
            <blockquote className="text-xl md:text-3xl font-medium leading-tight mb-6">
              &ldquo;{testimonials[current].quote}&rdquo;
            </blockquote>
            <div className="flex items-center justify-center gap-3">
              <TestimonialAvatar name={testimonials[current].name} size={48} />
              <div className="text-left">
                <div className="font-semibold text-sm">{testimonials[current].name}</div>
                <div className="text-xs text-zinc-400">{testimonials[current].role}</div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-center gap-2 mt-4">
        {testimonials.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            aria-label={`Testimonial ${i + 1}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === current ? "bg-teal-500 w-6" : "bg-zinc-700 w-1.5 hover:bg-zinc-500"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// --- Before/After Auto-Slider ---
// Uses a single image. Left half shows desaturated "Before", right shows vivid "After".
// Slider automatically sweeps back and forth. Manual drag pauses for 3s then resumes.
function BeforeAfterSlider({ src }: { src: string }) {
  const [split, setSplit] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef(50);
  const isDraggingRef = useRef(false);
  const pausedUntilRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    function tick(ts: number) {
      rafRef.current = requestAnimationFrame(tick);
      if (isDraggingRef.current || ts < pausedUntilRef.current) return;
      if (startTimeRef.current === null) startTimeRef.current = ts;
      // Sine wave: full cycle every 5 s, range 8%–92%
      const t = ((ts - startTimeRef.current) / 5000) * Math.PI * 2;
      const pos = 50 + Math.sin(t) * 42;
      splitRef.current = pos;
      setSplit(pos);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const applyDrag = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = Math.max(5, Math.min(((clientX - rect.left) / rect.width) * 100, 95));
    splitRef.current = pos;
    setSplit(pos);
  }, []);

  const startDrag = useCallback(() => { isDraggingRef.current = true; }, []);
  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    pausedUntilRef.current = performance.now() + 3000;
    startTimeRef.current = null; // restart sine from current position after resume
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchStart = (e: globalThis.TouchEvent) => { startDrag(); applyDrag(e.touches[0].clientX); };
    const onTouchMove = (e: globalThis.TouchEvent) => { e.preventDefault(); applyDrag(e.touches[0].clientX); };
    const onTouchEnd = () => endDrag();
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [startDrag, endDrag, applyDrag]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden cursor-ew-resize select-none border border-white/10 shadow-2xl shadow-teal-500/10"
      onMouseMove={(e) => { if (isDraggingRef.current) applyDrag(e.clientX); }}
      onMouseDown={startDrag}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* After layer — vivid image always fills full frame */}
      <img src={src} alt="After" draggable={false} className="absolute inset-0 w-full h-full object-cover" />

      {/* Before layer — clipped to left of split, desaturated */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        <img
          src={src}
          alt="Before"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "grayscale(90%) brightness(0.70) contrast(0.88)" }}
        />
        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.18)" }} />
      </div>

      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
        style={{ left: `calc(${split}% - 1px)`, boxShadow: "0 0 12px rgba(255,255,255,0.3)" }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg border border-zinc-200 pointer-events-auto">
          <div className="flex gap-0.5">
            <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
            <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-3 left-3 px-2.5 py-1 bg-black/55 backdrop-blur-md rounded-full text-[11px] font-medium text-white/70 border border-white/10 pointer-events-none">
        Before
      </div>
      <div className="absolute top-3 right-3 px-2.5 py-1 bg-teal-500/50 backdrop-blur-md rounded-full text-[11px] font-medium text-white border border-teal-500/20 pointer-events-none">
        After
      </div>
    </div>
  );
}

// --- Feature Card data ---
const features = [
  {
    icon: ImageIcon,
    title: "Instant Upscaling",
    desc: "Turn low-res images into crisp, high-definition masterpieces without losing detail or introducing artifacts.",
    color: "teal" as const,
  },
  {
    icon: PlayCircle,
    title: "Video Enhancement",
    desc: "Stabilize shaky footage, fix lighting, and apply cinematic color grading to your videos automatically.",
    color: "blue" as const,
  },
  {
    icon: Zap,
    title: "Magic Retouch",
    desc: "Remove blemishes, smooth skin, and perfect portraits while maintaining a natural, unedited look.",
    color: "emerald" as const,
  },
];

const colorMap = {
  teal: { bg: "bg-teal-500/10", text: "text-teal-400", border: "hover:border-teal-500/50", glow: "group-hover:shadow-teal-500/20" },
  blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "hover:border-blue-500/50", glow: "group-hover:shadow-blue-500/20" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "hover:border-emerald-500/50", glow: "group-hover:shadow-emerald-500/20" },
};

// --- Stats ---
const stats = [
  { icon: ImageUp, value: "10M+", label: "Photos Enhanced" },
  { icon: Users, value: "50K+", label: "Creators" },
  { icon: Clock, value: "<2s", label: "Avg. Processing" },
];

// ===== LANDING PAGE =====
export default function Landing() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-teal-500/30">
      {/* --- Nav (preserved) --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <Sparkles className="w-5 h-5 text-teal-500" />
            GlimpseAI
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
              Log in
            </Link>
            <Link href="/register">
              <Button className="bg-white text-black hover:bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* ===== HERO ===== */}
        <section className="pt-24 pb-12 relative overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-teal-600/20 blur-[120px] rounded-full pointer-events-none" />

          <div className="container mx-auto px-4 relative z-10 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-6"
            >
              <Wand2 className="w-4 h-4" />
              <span>Next-gen AI Editor Engine v3.0</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease }}
              className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter mb-4 bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-transparent"
            >
              Cinematic edits.
              <br />
              Zero effort.
            </motion.h1>

            {/* Rotating word line */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.18, ease }}
              className="text-2xl md:text-3xl font-semibold tracking-tight mb-4 text-white/80"
            >
              Make every frame <RotatingWord />
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.25, ease }}
              className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-8"
            >
              Transform ordinary photos and videos into stunning, professional-grade content with a single click. The power of a high-end creative studio, right in your browser.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.35, ease }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link href="/register">
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                  <Button
                    size="lg"
                    className="h-14 px-8 bg-teal-600 hover:bg-teal-700 text-white rounded-full text-base font-medium shadow-[0_0_30px_rgba(20,184,166,0.3)] hover:shadow-[0_0_40px_rgba(20,184,166,0.5)] transition-all"
                  >
                    Start Editing Free <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </motion.div>
              </Link>
              <div className="text-sm text-zinc-500 font-medium">No credit card required</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 1, delay: 0.55, ease }}
              className="mt-16 max-w-5xl mx-auto"
            >
              <BeforeAfterSlider src="/hero-after.png" />
            </motion.div>
          </div>
        </section>

        {/* ===== STATS BAR ===== */}
        <section className="py-10 bg-black border-b border-white/5">
          <div className="container mx-auto px-4">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-8 sm:gap-16">
              {stats.map((stat, i) => (
                <RevealOnScroll key={stat.label} delay={i * 0.1}>
                  <div className="flex items-center gap-3 text-center sm:text-left">
                    <div className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
                      <stat.icon className="w-5 h-5 text-teal-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold tracking-tight">{stat.value}</div>
                      <div className="text-xs text-zinc-500 font-medium">{stat.label}</div>
                    </div>
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section className="py-24 bg-zinc-950 border-y border-white/5 relative">
          <div className="container mx-auto px-4">
            <RevealOnScroll className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Professional tools, simplified.</h2>
              <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
                Everything you need to make your media stand out, powered by state-of-the-art artificial intelligence.
              </p>
            </RevealOnScroll>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {features.map((feat, i) => {
                const c = colorMap[feat.color];
                return (
                  <RevealOnScroll key={feat.title} delay={i * 0.12}>
                    <motion.div
                      whileHover={{ y: -6, transition: { duration: 0.25 } }}
                      className={`bg-black border border-white/10 rounded-2xl p-8 ${c.border} transition-colors group shadow-lg shadow-transparent ${c.glow}`}
                    >
                      <div className={`w-12 h-12 ${c.bg} rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                        <feat.icon className={`w-6 h-6 ${c.text}`} />
                      </div>
                      <h3 className="text-xl font-semibold mb-3">{feat.title}</h3>
                      <p className="text-zinc-400 leading-relaxed">{feat.desc}</p>
                    </motion.div>
                  </RevealOnScroll>
                );
              })}
            </div>
          </div>
        </section>

        {/* ===== TESTIMONIALS ===== */}
        <section className="py-24 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-teal-600/10 blur-[100px] rounded-full pointer-events-none" />

          <div className="container mx-auto px-4 relative z-10">
            <RevealOnScroll>
              <TestimonialCarousel />
            </RevealOnScroll>
          </div>
        </section>

        {/* ===== CTA ===== */}
        <section className="py-32 border-t border-white/10 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-teal-900/20 to-black pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-teal-600/15 blur-[100px] rounded-full pointer-events-none" />

          <div className="container mx-auto px-4 relative z-10 text-center">
            <RevealOnScroll>
              <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-6">Ready to create magic?</h2>
            </RevealOnScroll>
            <RevealOnScroll delay={0.1}>
              <p className="text-xl text-zinc-400 mb-10 max-w-xl mx-auto">
                Join thousands of creators using GlimpseAI to elevate their content. Get 5 free credits when you sign up today.
              </p>
            </RevealOnScroll>
            <RevealOnScroll delay={0.2}>
              <Link href="/register">
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} className="inline-block">
                  <Button
                    size="lg"
                    className="h-14 px-10 bg-white text-black hover:bg-zinc-200 rounded-full text-lg font-medium shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)] transition-all"
                  >
                    Start Creating Now
                  </Button>
                </motion.div>
              </Link>
            </RevealOnScroll>
          </div>
        </section>
      </main>

      {/* --- Footer (preserved) --- */}
      <footer className="border-t border-white/10 py-12 bg-zinc-950">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <Sparkles className="w-5 h-5 text-teal-500" />
            GlimpseAI
          </div>

          <div className="flex gap-8 text-sm text-zinc-500 font-medium">
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
            <a href="#" className="hover:text-white transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Contact
            </a>
          </div>

          <div className="text-sm text-zinc-600">&copy; {new Date().getFullYear()} GlimpseAI. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
