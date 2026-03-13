import Link from "next/link";

export default function Home() {
  return (
    <main className="h-screen bg-[#050608] text-white">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[58.5%_41.5%]">
        <section className="relative flex h-full flex-col border-b border-white/10 lg:border-b-0 lg:border-r lg:border-r-white/10">
          <div className="flex h-[41%] min-h-[320px] flex-col pl-6 pr-5 pb-6 pt-6 sm:pr-8">
            <h1 className="text-[58px] leading-none tracking-[0em] text-white/65">THE BOARD</h1>
            <p className="mt-6 max-w-[576px] text-[16px] leading-[1.55] text-white/55">
              Design starts here.
              <br />
              Collect. Curate. Create.
            </p>
            <p className="mt-auto pt-8 text-sm leading-8 text-white/55">Created by Miguel Leça</p>
          </div>

          <div className="relative mt-auto h-[59%] min-h-[340px] overflow-hidden border-t border-white/10 bg-black">
            <video
              className="pointer-events-none block h-full w-full object-cover select-none"
              src="/the-board-1.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
          </div>
        </section>

        <section className="flex h-full items-center justify-center bg-[#111317] px-12 py-20 sm:px-16 lg:px-20">
          <div className="w-full max-w-[520px] p-3 sm:p-5">
            <h2 className="text-[1.7rem] font-semibold leading-8 tracking-[-0.04em] text-white sm:text-[1.85rem]">Welcome back</h2>
            <p className="mt-5 text-sm leading-5 text-white/62">Ready to keep building your visual library?</p>

            <Link
              href="/main"
              className="mt-8 flex h-[42px] w-full items-center justify-center border border-white/25 bg-white/10 px-5 text-sm font-medium leading-5 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55"
            >
              Sign in
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
