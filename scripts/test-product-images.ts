import assert from "node:assert/strict";
import {
  productSlug,
  productImages,
  parseGallery,
  imageSwipeStep,
} from "../lib/product-images";
assert.equal(productSlug("Đóa Hồng Yêu Thương"), "doa-hong-yeu-thuong");
assert.equal(productSlug("  Hoa & Quà — 2026! "), "hoa-qua-2026");
assert.ok(productSlug("a".repeat(300)).length <= 180);
assert.deepEqual(productImages({ image: "/images/vase.jpg" }), [
  "/images/vase.jpg",
]);
assert.deepEqual(
  productImages({
    image: "/images/vase.jpg",
    gallery: '["/images/roses.jpg","/images/vase.jpg"]',
  }),
  ["/images/vase.jpg", "/images/roses.jpg"],
);
assert.deepEqual(parseGallery(null), []);
assert.deepEqual(parseGallery("broken"), []);
assert.equal(imageSwipeStep(-100, 10), 1, "Swipe left selects next image");
assert.equal(imageSwipeStep(100, 10), -1, "Swipe right selects previous image");
assert.equal(
  imageSwipeStep(10, 100),
  0,
  "Vertical scrolling does not change image",
);
assert.equal(
  imageSwipeStep(30, 1),
  0,
  "Tap or small movement does not change image",
);
console.log("11 product image and swipe checks passed.");
