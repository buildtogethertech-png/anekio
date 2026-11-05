import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { BACKGROUND_REFRESH_MS, RecordProvider, useRecord } from "../record";

const mockApi = jest.fn();
jest.mock("../api", () => ({ api: (...args: unknown[]) => mockApi(...args) }));
jest.mock("../session", () => ({ useSession: () => ({ token: "tok" }) }));
jest.mock("../storage", () => ({ getChildId: () => Promise.resolve(null), setChildId: () => Promise.resolve() }));

type Ctx = ReturnType<typeof useRecord>;
let ctx: Ctx;
function Grab() {
  ctx = useRecord();
  return <Text>{ctx.data ? "loaded" : "loading"}</Text>;
}

async function mount() {
  const view = render(
    <RecordProvider>
      <Grab />
    </RecordProvider>
  );
  await waitFor(() => expect(view.getByText("loaded")).toBeTruthy());
  return view;
}

describe("RecordProvider refresh", () => {
  let now = 1_000_000;
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockImplementation(() => Promise.resolve({ kind: "OFFICE", n: mockApi.mock.calls.length }));
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it("skips background refresh right after a load", async () => {
    await mount();
    expect(mockApi).toHaveBeenCalledTimes(1);
    await act(() => ctx.reloadInBackground());
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it("always reloads after the user's own save, even right after a background load", async () => {
    await mount();
    now += BACKGROUND_REFRESH_MS + 1;
    await act(() => ctx.reloadInBackground());
    expect(mockApi).toHaveBeenCalledTimes(2);
    await act(() => ctx.reloadSilently());
    await act(() => ctx.reload());
    expect(mockApi).toHaveBeenCalledTimes(4);
  });

  it("shares one request between background callers firing together", async () => {
    await mount();
    now += BACKGROUND_REFRESH_MS + 1;
    await act(() => Promise.all([ctx.reloadInBackground(), ctx.reloadInBackground(), ctx.reloadInBackground()]).then(() => undefined));
    expect(mockApi).toHaveBeenCalledTimes(2);
  });
});
