import { afterEach, describe, expect, it } from "vitest";
import { readSpsFromDocument } from "./spsCapture";
import { setRemoteCss } from "./scraper/domSelectors";

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
}

describe("read Shop Performance Score from Seller Center @F-SPS", () => {
  afterEach(() => setRemoteCss({}));

  it("reads the Account Health card by its label", () => {
    const page = doc(`
      <section class="health-card">
        <div class="title"><span>Shop Performance Score</span><span class="tip">?</span></div>
        <div class="value">3.2</div><div class="sub">Last 60 days · 98% on-time</div>
      </section>`);
    expect(readSpsFromDocument(page)).toBe(3.2);
  });

  it("reads the Home widget written as 'SPS 4.5 / 5'", () => {
    expect(readSpsFromDocument(doc(`<div class="widget"><p>SPS</p><b>4.5</b><i>/ 5</i></div>`))).toBe(4.5);
  });

  it("prefers the bundled test id, then a signed remote selector", () => {
    expect(readSpsFromDocument(doc(`<span data-testid="seller-score">2.75</span>`))).toBe(2.75);
    setRemoteCss({ spsScore: ".new-score-2027" });
    expect(readSpsFromDocument(doc(`<div class="new-score-2027">3.9</div>`))).toBe(3.9);
  });

  it("finds a score a few levels above the label, but never in page scripts", () => {
    expect(
      readSpsFromDocument(doc(`<div><div><div><span>Shop Performance Score</span><em>i</em></div></div><div><strong>3.9</strong> out of 5</div></div>`)),
    ).toBe(3.9);
    expect(
      readSpsFromDocument(doc(`<script>var l = "Shop Performance Score 4";</script><div class="card"><span>Shop Performance Score</span><span>Not enough orders yet (12/30)</span></div>`)),
    ).toBeNull();
  });

  it("ignores pages without a score and numbers that are not a 0-5 score", () => {
    expect(readSpsFromDocument(doc(`<h1>Manage products</h1><td>$39.99</td>`))).toBeNull();
    expect(readSpsFromDocument(doc(`<div class="card"><span>Shop Performance Score</span><span>Not enough orders yet (12/30)</span></div><p>Rating 4.8</p>`))).toBeNull();
  });
});
