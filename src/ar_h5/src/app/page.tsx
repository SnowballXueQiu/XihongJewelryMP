'use client'

import dynamic from "next/dynamic";

const TryOnApp = dynamic(() => import("../components/TryOnApp").then((m) => m.TryOnApp), {
  ssr: false,
});

export default function Page() {
  return <TryOnApp />;
}
