// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmployeeSpendingTable } from "./EmployeeSpendingTable";
import type { EmployeeMonthlySpend } from "@/lib/claim-service";

function row(overrides: Partial<EmployeeMonthlySpend> = {}): EmployeeMonthlySpend {
  return {
    userId: "u-1",
    name: "Sneha Iyer",
    role: "STAFF",
    limit: 15000,
    committed: 13500,
    pending: 2400,
    remaining: 1500,
    utilizationPct: 90,
    isNearLimit: true,
    isOverLimit: false,
    ...overrides,
  };
}

describe("EmployeeSpendingTable", () => {
  it("shows the empty state when there are no employees", () => {
    render(<EmployeeSpendingTable rows={[]} />);
    expect(screen.getByText(/no employees to report on/i)).toBeInTheDocument();
  });

  it("shows the employee's name, committed/pending/remaining figures, and utilization", () => {
    render(<EmployeeSpendingTable rows={[row()]} />);
    expect(screen.getByText("Sneha Iyer")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("shows a 'Near limit' badge for a near-limit employee, and 'Over limit' for an over-limit one", () => {
    render(
      <EmployeeSpendingTable
        rows={[
          row({ userId: "u-1", name: "Near Employee", isNearLimit: true, isOverLimit: false }),
          row({ userId: "u-2", name: "Over Employee", isNearLimit: false, isOverLimit: true }),
        ]}
      />
    );
    expect(screen.getByText("Near limit")).toBeInTheDocument();
    expect(screen.getByText("Over limit")).toBeInTheDocument();
  });

  it("shows no badge for an employee comfortably under their limit", () => {
    render(<EmployeeSpendingTable rows={[row({ isNearLimit: false, isOverLimit: false })]} />);
    expect(screen.queryByText("Near limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Over limit")).not.toBeInTheDocument();
  });
});
