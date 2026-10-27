"use client";

import dynamic from "next/dynamic";

// PDF.js needs the DOM; never render the reader on the server.
export const LazyReader = dynamic(() => import("./Reader"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
    </div>
  ),
});
