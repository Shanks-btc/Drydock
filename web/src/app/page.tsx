import Hero from "@/components/marketing/Hero";
import ProblemSection from "@/components/marketing/ProblemSection";
import HowItWorksPreview from "@/components/marketing/HowItWorksPreview";
import DemoTerminal from "@/components/marketing/DemoTerminal";
import Reveal from "@/components/primitives/Reveal";

export default function Home() {
  return (
    <main className="w-full max-w-full overflow-x-clip">
      <Hero />
      <Reveal>
        <ProblemSection />
      </Reveal>
      <Reveal>
        <HowItWorksPreview />
      </Reveal>
      <Reveal>
        <DemoTerminal />
      </Reveal>
    </main>
  );
}
