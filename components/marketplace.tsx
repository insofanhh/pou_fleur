"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  LocateFixed,
  ArrowUpRight,
  ArrowRight,
  Search,
  Flower2,
  Clock3,
} from "lucide-react";
import { api, useShop } from "./context";
import FlowerImage from "./flower-image";
import DeliveryAddress, { type DeliveryLocation } from "./delivery-address";
import { money } from "./home";
import { HANOI_LOCATION } from "@/lib/regional";
import { productSlug } from "@/lib/product-images";
import { aiAllowance, aiPlanAllowed } from "@/lib/ai-policy";
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
            "&session=discovery" + (location ? `&lat=${location.lat}&lng=${location.lng}` : ""),
        )
          .then((d) => active && setSuggestions(d.predictions || []))
          .catch((e) => active && setError(e.message)),
      400,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [address, location]);
  function choose(p: any) {
    setLocation(p);
    localStorage.setItem("fleur.delivery-location", JSON.stringify(p));
    setSuggestions([]);
  }
  return (
    <main className="marketplace">
      <section className="market-hero">
        <span className="eyebrow">FLEURIOUS · LOCAL FLORAL STUDIOS</span>
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
          <span className="eyebrow">GROW WITH FLEURIOUS</span>
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
          center: location ? [location.lng, location.lat] : [HANOI_LOCATION.lng, HANOI_LOCATION.lat],
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
  useEffect(() => {
    if (ready && location && selected === null)
      map.current.flyTo({ center: [location.lng, location.lat], zoom: 12 });
  }, [ready, location, selected]);
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
export function PendingStore() {
  return (
    <main className="page">
      <div className="empty pending-store-page" role="status">
        <Clock3 aria-hidden="true" />
        <h2>Cửa hàng đang chờ admin platform duyệt.</h2>
        <p>Bạn sẽ vào được workspace sau khi cửa hàng được chấp thuận.</p>
        <Link className="button" href="/">
          Tiếp tục khám phá <ArrowRight size={18} />
        </Link>
      </div>
    </main>
  );
}

export function StartStore() {
  const { user, ready } = useShop(),
    searchParams = useSearchParams(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [storeName, setStoreName] = useState(""),
    [customSlug, setCustomSlug] = useState<string | null>(null),
    [address, setAddress] = useState(""),
    [location, setLocation] = useState<DeliveryLocation | null>(null),
    [plans, setPlans] = useState<any[]>([]),
    [planId, setPlanId] = useState(1),
    [registration, setRegistration] = useState<{
      userId: number; eligible: boolean; message: string;
      store: { id: number; name: string; status: string } | null;
    } | null>(null),
    [registrationError, setRegistrationError] = useState("");
  const registrationRequest = useRef(0);
  async function checkRegistration() {
    if (!user) return;
    const request = ++registrationRequest.current;
    const userId = user.id;
    setRegistrationError("");
    try {
      const result = await api("stores/registration");
      if (request === registrationRequest.current) setRegistration({ ...result, userId });
    } catch {
      if (request === registrationRequest.current)
        setRegistrationError("Chưa thể kiểm tra quyền mở cửa hàng. Vui lòng thử lại.");
    }
  }
  async function loadPlans() {
    try { setPlans(await api("billing/plans")); }
    catch { setError("Chưa tải được gói dịch vụ. Vui lòng tải lại trang trước khi đăng ký."); }
  }
  useEffect(() => { if (ready) void loadPlans(); }, [ready, user?.id]);
  useEffect(() => {
    if (ready && user) void checkRegistration();
    return () => { registrationRequest.current++; };
  }, [ready, user?.id]);
  const selectedPlan = plans.find(p => Number(p.id) === planId);
  const nameSlug = productSlug(storeName);
  const automaticSlug = (/^\d+$/.test(nameSlug) ? "store-" + nameSlug : nameSlug)
    .slice(0, 80).replace(/-+$/g, "");
  const storeSlug = customSlug ?? automaticSlug;
  const checked = user && registration?.userId === user.id ? registration : null;
  if (searchParams.get("pending")) return <PendingStore />;
  if (ready && checked?.store?.status === "pending")
    return <PendingStore />;
  if (ready && checked && !checked.eligible)
    return (
      <main className="page">
        <div className="empty pending-store-page" role="status">
          <Flower2 aria-hidden="true" />
          <h2>{checked.store ? "Bạn đã có cửa hàng." : "Thông tin đã được dùng để mở cửa hàng."}</h2>
          <p>{checked.message}</p>
          {checked.store ? (
            <Link className="button" href={"/workspace/" + checked.store.id + "/overview"}>
              Vào workspace <ArrowRight size={18} />
            </Link>
          ) : <Link className="button" href="/account">Kiểm tra tài khoản</Link>}
        </div>
      </main>
    );
  return (
    <main className="page start-store-page">
      <span className="eyebrow">YOUR NEXT CHAPTER</span>
      <h1>Mở tiệm hoa của bạn.</h1>
      <p>
        Bắt đầu với thông tin cơ bản. Hoàn tất địa chỉ, giao diện và sản phẩm để
        đưa cửa hàng vào hoạt động.
      </p>
      {!ready ? (
        <p>Đang tải…</p>
      ) : !user ? (
        <Link className="button" href="/login?next=/start">
          Đăng nhập để bắt đầu
        </Link>
      ) : !checked ? (
        <div role="status">
          <p>{registrationError || "Đang kiểm tra thông tin đăng ký…"}</p>
          {registrationError && <button className="button" onClick={() => void checkRegistration()}>Thử lại</button>}
        </div>
      ) : (
        <form
          className="start-store-layout"
          aria-busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !selectedPlan) return;
            setBusy(true);
            try {
              const form = Object.fromEntries(new FormData(e.currentTarget));
              const d = await api(
                "stores",
                "POST",
                {
                  ...form,
                  plan_id: planId,
                  offer_version_id: selectedPlan?.offer_version_id,
                  lat: location?.lat ?? null,
                  lng: location?.lng ?? null,
                },
              );
              window.location.href =
                d.status === "pending"
                  ? "/start/pending?store=" + d.id
                  : "/workspace/" + d.id + (d.requiresPayment ? "/billing" : "/settings");
            } catch (e) {
              setError((e as Error).message);
              await Promise.all([loadPlans(), checkRegistration()]);
            } finally {
              setBusy(false);
            }
          }}
        >
          <section className="start-store-plans">
            <div className="section-heading"><div><span className="eyebrow">CHỌN GÓI PHÙ HỢP</span><h2>Gói dịch vụ cho tiệm hoa</h2><p className="small">Gói dùng thử không tự động trừ tiền. Khi thời gian dùng thử kết thúc, bạn có thể tiếp tục theo giá tháng hiển thị.</p></div></div>
            <div className="start-store-plan-grid">{plans.map((p: any) => { const limits = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {}; const isSelected = Number(p.id) === planId; const hasTrial = Number(p.trial_days) > 0 && (p.registration_trial_available); return <button type="button" disabled={busy} className={"start-store-plan-card" + (isSelected ? " selected" : "")} key={p.id} onClick={() => setPlanId(Number(p.id))} aria-pressed={isSelected}><span className="eyebrow">GÓI {p.id}</span><div className="start-store-plan-title"><h3>{p.name}</h3>{isSelected && <span className="tag">Đang chọn</span>}</div>{hasTrial ? <><div className="start-store-trial-price">0 VNĐ <small>trong {p.trial_days} ngày dùng thử</small></div><p className="start-store-original-price">Sau dùng thử: <strong>{money(Number(p.monthly_price))}</strong> / tháng</p></> : <div className="start-store-trial-price">{money(Number(p.monthly_price))}<small>/ tháng</small></div>}<div className="start-store-plan-limits"><span>{Number(limits.products || 0).toLocaleString("vi-VN")} sản phẩm</span><span>{Number(limits.staff || 0).toLocaleString("vi-VN")} nhân sự</span><span>{Number(limits.storage_mb || 0).toLocaleString("vi-VN")} MB lưu trữ</span><span>{Number(limits.email_sends || 0).toLocaleString("vi-VN")} email cửa hàng/tháng</span>{aiPlanAllowed(Number(p.id)) && <span>{aiAllowance(Number(p.id), limits).toLocaleString("vi-VN")} lượt trợ lý AI/tháng</span>}</div><span className="text-link">Chọn gói này <ArrowRight size={15}/></span></button>; })}</div>
          </section>
          <section className="panel start-store-form">
            <div className="section-heading"><div><span className="eyebrow">THÔNG TIN CỬA HÀNG</span><h2>Tạo workspace</h2><p className="small">Bạn có thể cập nhật giao diện, sản phẩm và thành viên sau khi mở cửa hàng.</p></div></div>
            <p className="start-store-selected-plan">Gói đang chọn: <strong>{selectedPlan?.name || "—"}</strong>{selectedPlan && <span> · {selectedPlan.registration_trial_available ? `0 VNĐ trong ${selectedPlan.trial_days} ngày dùng thử` : `${money(Number(selectedPlan.monthly_price))}/tháng`}</span>}</p>
            <label className="field">Tên cửa hàng<input required name="name" maxLength={160} value={storeName} onChange={(e) => setStoreName(e.target.value)} /></label>
            <div className="field">
              <label htmlFor="start-store-slug">Đường dẫn store</label>
              <input id="start-store-slug" required name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} placeholder="ten-tiem-hoa" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={storeSlug} onChange={(e) => setCustomSlug(e.target.value)} />
              {customSlug !== null && <button type="button" className="text-link small" onClick={() => setCustomSlug(null)}>Tạo lại theo tên</button>}
            </div>
            <DeliveryAddress value={address} onChange={setAddress} location={location} onLocation={setLocation} enabled label="Địa chỉ cửa hàng" className="" selectionHint="Đã chọn vị trí cửa hàng. Bạn vẫn có thể bổ sung số nhà hoặc hướng dẫn trong địa chỉ." />
            <label className="field">Điện thoại<input required type="tel" name="phone" autoComplete="tel" defaultValue={user.phone || ""} minLength={9} maxLength={30} /></label>
            <p className="small">Mỗi tài khoản, email và số điện thoại chỉ được dùng để mở một cửa hàng.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="button" disabled={busy || !selectedPlan}>{busy && <span className="button-spinner" aria-hidden="true" />}{busy ? "Đang tạo cửa hàng…" : "Tạo cửa hàng"}</button>
          </section>
        </form>
      )}
    </main>
  );
}
