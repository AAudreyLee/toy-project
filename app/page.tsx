import { GuidedPlanning } from "@/features/guided-planning/ui/GuidedPlanning";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <GuidedPlanning />
    </main>
  );
}
