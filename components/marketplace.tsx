"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  LocateFixed,
  ArrowUpRight,
  Search,
  Flower2,
} from "lucide-react";
import { api, useShop } from "./context";
import FlowerImage from "./flower-image";
export default function Marketplace() {
  const [stores, setStores] = useState<any[]>([]),
    [error, setError] = useState(""),
    [q, setQ] = useState(""),
    [location, setLocation] = useState<any>(null),
    [address, setAddress] = useState(""),
    [suggestions, setSuggestions] = useState<any[]>([]),
    [view, setView] = useState("list"),
    [selected, setSelected] = useState<number | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    try {
      const p = JSON.parse(
        localStorage.getItem("fleur.delivery-location") || "null",
      );
      if (p) setLocation(p);
    } catch {}
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api(
      "stores?q=" +
        encodeURIComponent(q) +
        (location ? "&lat=" + location.lat + "&lng=" + location.lng : ""),
    )
      .then((d) => {
        if (active) {
          setStores(d);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q, location]);
  useEffect(() => {
    if (address.length < 3) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const t = setTimeout(
      () =>
        api(
          "goong/search?input=" +
            encodeURIComponent(address) +
            "&session=discovery",
        )
          .then((d) => active && setSuggestions(d.predictions || []))
          .catch((e) => active && setError(e.message)),
      400,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [address]);
  function choose(p: any) {
    setLocation(p);
    localStorage.setItem("fleur.delivery-location", JSON.stringify(p));
    setSuggestions([]);
  }
  return (
    <main className="marketplace">
      <section className="market-hero">
        <span className="eyebrow">FLEUR · LOCAL FLORAL STUDIOS</span>
        <h1>
          Một tiệm hoa gần bạn.
          <br />
          <span>Một điều đẹp gửi đi.</span>
        </h1>
        <p>
          Khám phá những cửa hàng hoa độc lập, chọn thiết kế bạn yêu và gửi trao
          đúng nơi, đúng lúc.
        </p>
        <div className="location-search">
          <MapPin size={21} />
          <input
            aria-label="Địa chỉ nhận hoa"
            placeholder="Hoa sẽ được gửi đến đâu?"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            aria-label="Dùng vị trí của tôi"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                (p) =>
                  choose({
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    label: "Vị trí của bạn",
                  }),
                () =>
                  setError(
                    "Chưa lấy được vị trí. Bạn có thể nhập địa chỉ nhận hoa.",
                  ),
              )
            }
          >
            <LocateFixed size={20} />
          </button>
          {!!suggestions.length && (
            <div className="address-suggestions">
              {suggestions.map((p) => (
                <button
                  key={p.place_id}
                  onClick={async () => {
                    try {
                      const d = await api(
                        "goong/detail?place_id=" +
                          encodeURIComponent(p.place_id) +
                          "&session=discovery",
                      );
                      choose({
                        ...d.result.geometry.location,
                        label: p.description,
                      });
                      setAddress("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {p.description}
                </button>
              ))}
            </div>
          )}
        </div>
        <small>
          {location
            ? `Giao đến: ${location.label} · Khoảng cách đường chim bay`
            : "Chọn địa chỉ người nhận để tìm store phù hợp. Bạn cũng có thể xem tất cả bên dưới."}
        </small>
      </section>
      <section className="market-results">
        <div className="flex-between">
          <div>
            <span className="eyebrow">FIND YOUR FLORIST</span>
            <h2>
              {location
                ? "Cửa hàng quanh nơi nhận hoa"
                : "Những cửa hàng hoa của bạn"}
            </h2>
          </div>
          <div className="segmented">
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              Danh sách
            </button>
            <button
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              Bản đồ
            </button>
          </div>
        </div>
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Tìm cửa hàng"
            placeholder="Tìm cửa hàng theo tên…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {error && (
          <p role="status" className="notice">
            {error}
          </p>
        )}
        {loading && <p role="status">Đang tìm cửa hàng…</p>}
        <div className={view === "map" ? "discovery-split" : ""}>
          <div className="store-grid">
            {stores.map((s) => (
              <article
                className={
                  "store-card " + (selected === s.id ? "selected" : "")
                }
                key={s.id}
                onMouseEnter={() => setSelected(s.id)}
              >
                <Link href={"/s/" + s.slug} className="store-card-image">
                  <FlowerImage
                    src={s.cover || "/images/hero.jpg"}
                    alt={s.name}
                    sizes="(max-width:700px) 100vw,33vw"
                  />
                  <span>{s.settings?.open ? "Đang nhận đơn" : "Tạm nghỉ"}</span>
                </Link>
                <div className="flex-between">
                  <h3>
                    <Link href={"/s/" + s.slug}>{s.name}</Link>
                  </h3>
                  <ArrowUpRight size={19} />
                </div>
                <p>
                  {s.description || "Thiết kế hoa cho những dịp thật riêng."}
                </p>
                <small>
                  <MapPin size={13} />
                  {s.address || "Cửa hàng trực tuyến"}
                  {s.distance !== null
                    ? " · " + s.distance.toFixed(1) + " km"
                    : ""}
                </small>
                {s.distance !== null && s.distance > s.radius_km && (
                  <small>
                    Địa chỉ ngoài bán kính giao dự kiến. Liên hệ store để được
                    hỗ trợ.
                  </small>
                )}
              </article>
            ))}
          </div>
          {view === "map" && (
            <StoreMap
              stores={stores}
              selected={selected}
              select={setSelected}
              location={location}
            />
          )}
        </div>
        {!loading && !stores.length && (
          <div className="empty">
            <Flower2 />
            <h3>Chưa tìm thấy cửa hàng.</h3>
            <p>Thử một tên khác hoặc thay đổi địa chỉ nhận hoa.</p>
          </div>
        )}
      </section>
      <section className="merchant-banner">
        <div>
          <span className="eyebrow">GROW WITH FLEUR</span>
          <h2>Mỗi tiệm hoa, một câu chuyện.</h2>
          <p>Mang cửa hàng của bạn đến gần những người yêu hoa hơn.</p>
        </div>
        <Link className="button" href="/start">
          Mở cửa hàng <ArrowUpRight size={18} />
        </Link>
      </section>
    </main>
  );
}
let sdk: Promise<void> | null = null;
function loadMap() {
  if (!sdk)
    sdk = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href =
        "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/@goongmaps/goong-js@1.0.9/dist/goong-js.js";
      s.onload = () => resolve();
      s.onerror = () => {
        sdk = null;
        reject(Error("Không tải được bản đồ."));
      };
      document.head.appendChild(s);
    });
  return sdk;
}
export function StoreMap({
  stores,
  selected,
  select,
  location,
}: {
  stores: any[];
  selected: number | null;
  select: (id: number) => void;
  location: any;
}) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<any>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_GOONG_MAPTILES_KEY) {
      setError("Bản đồ chưa được bật. Danh sách cửa hàng vẫn hoạt động.");
      return;
    }
    let active = true;
    loadMap()
      .then(() => {
        if (!active || !el.current) return;
        const g = (window as any).goongjs;
        g.accessToken = process.env.NEXT_PUBLIC_GOONG_MAPTILES_KEY;
        map.current = new g.Map({
          container: el.current,
          style: "https://tiles.goong.io/assets/goong_map_web.json",
          center: location ? [location.lng, location.lat] : [106.7009, 10.7769],
          zoom: 12,
        });
        map.current.on("error", () =>
          setError("Chưa tải được bản đồ. Vui lòng dùng danh sách."),
        );
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
      map.current?.remove();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const g = (window as any).goongjs,
      markers: any[] = [];
    for (const s of stores) {
      if (s.lat === null || s.lng === null) continue;
      const b = document.createElement("button");
      b.className = "map-store-pin" + (s.id === selected ? " active" : "");
      b.textContent = s.name;
      b.onclick = () => select(s.id);
      markers.push(
        new g.Marker(b).setLngLat([s.lng, s.lat]).addTo(map.current),
      );
    }
    const s = stores.find((s) => s.id === selected);
    if (s?.lat !== null && s?.lng !== null && s)
      map.current.flyTo({ center: [s.lng, s.lat], zoom: 13 });
    return () => markers.forEach((m) => m.remove());
  }, [ready, stores, selected]);
  return (
    <aside className="store-map">
      <div ref={el} className="map-canvas" />
      {error && <p className="map-fallback">{error}</p>}
      {selected && (
        <Link
          className="map-open-store button"
          href={"/s/" + stores.find((s) => s.id === selected)?.slug}
        >
          Mở cửa hàng đã chọn
        </Link>
      )}
    </aside>
  );
}
export function StartStore() {
  const { user, ready } = useShop(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="page narrow">
      <span className="eyebrow">YOUR NEXT CHAPTER</span>
      <h1>Mở tiệm hoa của bạn.</h1>
      <p>
        Bắt đầu với bản nháp. Hoàn tất địa chỉ, giao diện và sản phẩm trước khi
        gửi duyệt.
      </p>
      {!ready ? (
        <p>Đang tải…</p>
      ) : !user ? (
        <Link className="button" href="/login?next=/start">
          Đăng nhập để bắt đầu
        </Link>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const d = await api(
                "stores",
                "POST",
                Object.fromEntries(new FormData(e.currentTarget)),
              );
              window.location.href = "/workspace/" + d.id + "/settings";
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Tên cửa hàng
            <input required name="name" maxLength={160} />
          </label>
          <label className="field">
            Đường dẫn store
            <input
              required
              name="slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              minLength={3}
              placeholder="ten-tiem-hoa"
            />
          </label>
          <label className="field">
            Địa chỉ cửa hàng
            <input required name="address" minLength={10} />
          </label>
          <label className="field">
            Điện thoại
            <input required name="phone" minLength={9} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="button" disabled={busy}>
            {busy ? "Đang tạo…" : "Tạo cửa hàng"}
          </button>
        </form>
      )}
    </main>
  );
}
