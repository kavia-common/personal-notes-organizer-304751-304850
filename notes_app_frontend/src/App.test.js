import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders top navigation with the Ocean Notes title", () => {
  render(<App />);
  // Use role+name to avoid matching demo note content that also contains "Ocean Notes"
  expect(screen.getByRole("banner", { name: /top navigation/i })).toBeInTheDocument();
  expect(screen.getByRole("banner", { name: /top navigation/i })).toHaveTextContent(/Ocean Notes/i);
});
