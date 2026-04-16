import React, { useState, useRef, MouseEvent, TouchEvent } from "react";
import { Link } from "wouter";
import { Sparkles, Wand2, ArrowRight, Star, PlayCircle, Zap, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

function BeforeAfterSlider({ beforeSrc, afterSrc }: { beforeSrc: string, afterSrc: string }) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    setSliderPosition(percentage);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    handleMove(e.clientX);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    handleMove(e.touches[0].clientX);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video rounded-2xl overflow-hidden cursor-ew-resize select-none border border-white/10 shadow-2xl shadow-purple-500/20"
      onMouseMove={onMouseMove}
      onTouchMove={onTouchMove}
      onMouseDown={() => setIsDragging(true)}
      onTouchStart={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
      onTouchEnd={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
    >
      <img 
        src={beforeSrc} 
        alt="Before" 
        className="absolute inset-0 w-full h-full object-cover grayscale-[50%] contrast-75 brightness-75"
      />
      
      <div 
        className="absolute inset-0 w-full h-full overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img 
          src={afterSrc} 
          alt="After" 
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      <div 
        className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-[0_0_10px_rgba(0,0,0,0.5)]"
        style={{ left: `calc(${sliderPosition}% - 2px)` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg border border-zinc-200">
          <div className="flex gap-1">
            <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
            <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
          </div>
        </div>
      </div>

      <div className="absolute top-4 left-4 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-xs font-medium text-white border border-white/10">Before</div>
      <div className="absolute top-4 right-4 px-3 py-1 bg-purple-500/50 backdrop-blur-md rounded-full text-xs font-medium text-white border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.5)]">AI Enhanced</div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
      <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <Sparkles className="w-5 h-5 text-purple-500" />
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
        <section className="pt-32 pb-20 relative overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-600/20 blur-[120px] rounded-full pointer-events-none" />
          
          <div className="container mx-auto px-4 relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-medium mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <Wand2 className="w-4 h-4" />
              <span>Next-gen AI Editor Engine v3.0</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tighter mb-6 bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-transparent animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
              Cinematic edits.<br />Zero effort.
            </h1>
            
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-10 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200">
              Transform ordinary photos and videos into stunning, professional-grade content with a single click. The power of a high-end creative studio, right in your browser.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300">
              <Link href="/register">
                <Button size="lg" className="h-14 px-8 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium shadow-[0_0_30px_rgba(147,51,234,0.3)] hover:shadow-[0_0_40px_rgba(147,51,234,0.5)] transition-all">
                  Start Editing Free <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <div className="text-sm text-zinc-500 font-medium">No credit card required</div>
            </div>

            <div className="mt-24 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-500">
              <BeforeAfterSlider 
                beforeSrc="/hero-before.png" 
                afterSrc="/hero-after.png" 
              />
            </div>
          </div>
        </section>

        <section className="py-24 bg-zinc-950 border-y border-white/5 relative">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Professional tools, simplified.</h2>
              <p className="text-zinc-400 max-w-2xl mx-auto text-lg">Everything you need to make your media stand out, powered by state-of-the-art artificial intelligence.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              <div className="bg-black border border-white/10 rounded-2xl p-8 hover:border-purple-500/50 transition-colors group">
                <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <ImageIcon className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Instant Upscaling</h3>
                <p className="text-zinc-400 leading-relaxed">Turn low-res images into crisp, high-definition masterpieces without losing detail or introducing artifacts.</p>
              </div>

              <div className="bg-black border border-white/10 rounded-2xl p-8 hover:border-blue-500/50 transition-colors group">
                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <PlayCircle className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Video Enhancement</h3>
                <p className="text-zinc-400 leading-relaxed">Stabilize shaky footage, fix lighting, and apply cinematic color grading to your videos automatically.</p>
              </div>

              <div className="bg-black border border-white/10 rounded-2xl p-8 hover:border-emerald-500/50 transition-colors group">
                <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Zap className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Magic Retouch</h3>
                <p className="text-zinc-400 leading-relaxed">Remove blemishes, smooth skin, and perfect portraits while maintaining a natural, unedited look.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-600/10 blur-[100px] rounded-full pointer-events-none" />
          
          <div className="container mx-auto px-4 relative z-10">
            <div className="max-w-4xl mx-auto text-center">
              <div className="flex justify-center gap-1 mb-6">
                {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-6 h-6 fill-purple-500 text-purple-500" />)}
              </div>
              <blockquote className="text-2xl md:text-4xl font-medium leading-tight mb-8">
                "GlimpseAI completely replaced my complex editing workflow. What used to take hours in professional software now takes seconds in the browser."
              </blockquote>
              <div className="flex items-center justify-center gap-4">
                <div className="w-12 h-12 rounded-full bg-zinc-800 border border-white/20 overflow-hidden">
                  <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah" alt="Sarah" className="w-full h-full" />
                </div>
                <div className="text-left">
                  <div className="font-semibold">Sarah Jenkins</div>
                  <div className="text-sm text-zinc-400">Professional Photographer</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-32 border-t border-white/10 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-black pointer-events-none" />
          
          <div className="container mx-auto px-4 relative z-10 text-center">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-6">Ready to create magic?</h2>
            <p className="text-xl text-zinc-400 mb-10 max-w-xl mx-auto">Join thousands of creators using GlimpseAI to elevate their content. Get 5 free credits when you sign up today.</p>
            
            <Link href="/register">
              <Button size="lg" className="h-14 px-10 bg-white text-black hover:bg-zinc-200 rounded-full text-lg font-medium shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)] transition-all">
                Start Creating Now
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-12 bg-zinc-950">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <Sparkles className="w-5 h-5 text-purple-500" />
            GlimpseAI
          </div>
          
          <div className="flex gap-8 text-sm text-zinc-500 font-medium">
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
          
          <div className="text-sm text-zinc-600">
            © {new Date().getFullYear()} GlimpseAI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
