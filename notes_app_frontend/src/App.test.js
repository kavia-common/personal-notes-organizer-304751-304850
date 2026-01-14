import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders Ocean Notes header", () => {
  render(<App />);
  const title = screen.getByText(/Ocean Notes/i);
  expect(title).toBeInTheDocument();
});
