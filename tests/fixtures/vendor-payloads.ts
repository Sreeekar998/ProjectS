// Vendor payloads shaped on real responses captured with the operator's keys on
// 2026-09-15 (field names and nesting are exact; answer text is shortened and
// invented brands are used so no fixture reads as a live observation). Never
// present these as observations.

export const BRIGHTDATA_RECORD = {
  url: "https://chatgpt.com/?q=best%20trail%20running%20shoes",
  prompt: "best trail running shoes",
  // Inline links arrive as numbered placeholders; links_attached carries the text.
  answer_text: "For rocky trails the [1] and the [2] are the usual picks; [3] is a lighter option for beginners. [4]",
  answer_text_raw: "For rocky trails the [1] and the [2] are the usual picks; [3] is a lighter option for beginners.\n[4]",
  answer_text_markdown: "For rocky trails the \\[1\\] and the \\[2\\] are the usual picks; \\[3\\] is a lighter option for beginners.\n\n- Salomon: grip\n- Hoka: cushioning\n- TrailStride: weight \\[4\\]",
  answer_html: '<html class="xsw4dja xpezmfm" lang="en-US" data-build="prod-4ec31e730ff961987ab0f9a7e9dd6248f66da3b0"><body>…</body></html>',
  answer_section_html: "<li>…</li>",
  model: null,
  web_search_triggered: true,
  web_search_query: null,
  is_map: false,
  shopping_visible: false,
  shopping: [],
  citations: [
    { url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", title: "Best Trail Running Shoes 2026", description: "Runner's World", icon: null, domain: "https://www.runnersworld.com", cited: true, position: 1, answer_position: null },
    { url: "https://reviews.example/trail-shoes?utm_source=chatgpt.com", title: "Trail shoe reviews", description: "reviews.example", icon: null, domain: "https://reviews.example", cited: true, position: 2, answer_position: null },
  ],
  search_sources: [{ url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", title: "Best Trail Running Shoes 2026", snippet: null, rank: 1, date_published: null }],
  links_attached: [
    { url: "https://www.salomon.com/?utm_source=chatgpt.com", text: "Salomon Speedcross 6", position: 1 },
    { url: "https://www.hoka.com/?utm_source=chatgpt.com", text: "Hoka Speedgoat 6", position: 2 },
    { url: "https://trailstride.example/shoes", text: "TrailStride", position: 3 },
    { url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", text: "Best Trail Running Shoes 2026", position: 4 },
  ],
  recommendations: null,
  references: null,
  additional_prompt: null,
  additional_answer_text: null,
  ads: { carousel_cards: null },
  prompt_sent_at: "2026-09-15T11:55:57.491Z",
  timestamp: "2026-09-15T11:56:49.649Z",
  country: "US",
  input: { url: "https://chatgpt.com/", prompt: "best trail running shoes", country: "US", web_search: true, additional_prompt: "", geolocation: "" },
};

export const BRIGHTDATA_EMPTY_RECORD = {
  ...BRIGHTDATA_RECORD,
  answer_text: "Map data is currently unavailable",
  answer_text_raw: "Map data is currently unavailable",
  answer_text_markdown: "*   Map data is currently unavailable",
  citations: [],
  search_sources: [],
  links_attached: [],
  web_search_triggered: false,
};

export const CLORO_RESULT = {
  text: "For rocky trails the Salomon Speedcross 6 and the Hoka Speedgoat 6 are the usual picks; TrailStride is a lighter option for beginners.",
  markdown: "For rocky trails the **Salomon Speedcross 6** and the **Hoka Speedgoat 6** are the usual picks; **TrailStride** is a lighter option for beginners.",
  html: "https://cdn.cloro.example/html/abc123.html",
  model: "",
  searchQueries: ["best trail running shoes 2026"],
  sources: [
    { position: 1, url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", label: "Best Trail Running Shoes 2026", description: "Runner's World", datePublished: "2026-03-01", footnote: false },
    { position: 2, url: "https://reviews.example/trail-shoes", label: "Trail shoe reviews", description: null, datePublished: null, footnote: true },
  ],
  citationPills: [{ url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", label: "runnersworld.com", domain: "runnersworld.com", citationPillId: 0, type: "searchResult", position: 1 }],
  shoppingCards: [],
  inlineProducts: [],
  entities: [{ type: "product", name: "Salomon Speedcross 6" }],
  ads: [],
};

export const CLORO_EMPTY_RESULT = { ...CLORO_RESULT, text: "I can't help with that.", markdown: "I can't help with that.", sources: [], citationPills: [], searchQueries: [] };

/** Decodo's parsed answer sits under content.results; llm_model is populated. */
export const DECODO_RESULT = {
  content: {
    results: {
      citations: [{ text: "Runner's World", title: "Best Trail Running Shoes 2026", url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", description: "Mar 1, 2026" }],
      llm_model: "gpt-5-6",
      markdown_json: [{ children: [{ raw: "For rocky trails the Salomon Speedcross 6…", type: "text" }], type: "paragraph" }],
      markdown_text: "For rocky trails the **Salomon Speedcross 6** and the **Hoka Speedgoat 6** are the usual picks; **TrailStride** is a lighter option for beginners. [Runner's World](https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com)",
      parse_status_code: 12000,
      prompt: "best trail running shoes",
      raw_response: ["event: delta_encoding", 'data: "v1"'],
      response_text: "For rocky trails the Salomon Speedcross 6 and the Hoka Speedgoat 6 are the usual picks; TrailStride is a lighter option for beginners.",
      search_queries: ["best trail running shoes 2026"],
      links: [{ url: "https://trailstride.example/shoes", text: "TrailStride" }],
    },
    errors: [],
    status_code: 200,
    task_id: "7505595815340045313",
  },
  headers: {},
  status_code: 200,
  task_id: "7505595815340045313",
  created_at: "2026-09-15 12:01:10",
  updated_at: "2026-09-15 12:03:08",
};

/** Oxylabs job result, shaped on the documented sample (not yet seen live). */
export const OXYLABS_RESULT = {
  content: {
    prompt: "best trail running shoes",
    llm_model: "gpt-5-5",
    response_text: "For rocky trails the Salomon Speedcross 6 and the Hoka Speedgoat 6 are the usual picks; TrailStride is a lighter option for beginners.",
    markdown_text: "For rocky trails the **Salomon Speedcross 6** and the **Hoka Speedgoat 6** are the usual picks; **TrailStride** is a lighter option for beginners.",
    markdown_json: [],
    citations: [{ title: "Best Trail Running Shoes 2026", url: "https://www.runnersworld.com/gear/best-trail-running-shoes?utm_source=chatgpt.com", text: "Runner's World", description: "Mar 1, 2026" }],
    search_queries: ["best trail running shoes 2026"],
    links: [{ url: "https://trailstride.example/shoes", text: "TrailStride" }],
    parse_status_code: 12000,
  },
  created_at: "2026-09-15 12:01:10",
  updated_at: "2026-09-15 12:01:46",
  page: 1,
  url: "https://chatgpt.com/?model=auto",
  job_id: "7470033199733683201",
  status_code: 200,
  parser_type: "chatgpt",
};

/** What Decodo returns (with HTTP 200 or 400) when the target could not be scraped. */
export const DECODO_FAILED = { status: "failed", status_code: 613, message: "We were not able to scrape the target. You can try the following: 1) Switch between JS and non-JS rendering, 2) Retry the request, 3) Switch to a different geo-location.", task_id: "7505597135333666818" };
