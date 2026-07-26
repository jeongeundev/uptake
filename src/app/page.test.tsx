import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/survey-wizard", () => ({
  default: () => <div>SURVEY WIZARD</div>,
}));
vi.mock("@/components/authoring-wizard", () => ({
  default: () => <div>AUTHORING WIZARD</div>,
}));
vi.mock("@/components/catalog-bindings-wizard", () => ({
  default: () => <div>INSTANTIATION WIZARD</div>,
}));

import Home from "@/app/page";

describe("Home", () => {
  it("places SURVEY before the existing authoring and instantiation sections", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup.indexOf('href="#survey"')).toBeLessThan(
      markup.indexOf('href="#authoring"'),
    );
    expect(markup.indexOf('id="survey"')).toBeLessThan(
      markup.indexOf('id="authoring"'),
    );
    expect(markup.indexOf('id="authoring"')).toBeLessThan(
      markup.indexOf('id="instantiation"'),
    );
  });
});
