// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategorySpendingTable } from "./CategorySpendingTable";
import type { CategoryMonthlySpend } from "@/lib/claim-service";

describe("CategorySpendingTable", () => {
  it("shows every category's label, amount, and share", () => {
    const rows: CategoryMonthlySpend[] = [
      { category: "TAXI", amount: 300, percentage: 30 },
      { category: "MEALS", amount: 700, percentage: 70 },
      { category: "TRAVEL", amount: 0, percentage: 0 },
      { category: "SUPPLIES", amount: 0, percentage: 0 },
      { category: "OTHER", amount: 0, percentage: 0 },
    ];
    render(<CategorySpendingTable rows={rows} />);
    expect(screen.getByText("Taxi")).toBeInTheDocument();
    expect(screen.getByText("Meals")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });
});
