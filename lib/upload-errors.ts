// Never return SDK messages verbatim: they can include credentials or request data.
export function uploadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    /public.*private store|store.*configured.*private|access.*does not match/i.test(
      message,
    )
  )
    return {
      code: "BLOB_ACCESS_MODE",
      status: 503,
      message:
        "Kho Blob đang dùng chế độ truy cập không phù hợp. Ảnh sản phẩm cần Public Blob store; hãy kiểm tra Access của kho đã kết nối rồi redeploy.",
    };
  if (/OIDC.*environment/i.test(message))
    return {
      code: "BLOB_ENVIRONMENT",
      status: 503,
      message:
        "Kết nối Blob chưa cho phép môi trường Production. Hãy kết nối kho ảnh với Production rồi redeploy.",
    };
  if (
    /no blob credentials|no read.write token|no storeId|Access denied|token.*expired|invalid.*token/i.test(
      message,
    )
  )
    return {
      code: "BLOB_AUTH",
      status: 503,
      message:
        "Blob không xác thực được quyền tải ảnh. Kiểm tra kết nối BLD_STORE_ID/OIDC hoặc BLD_READ_WRITE_TOKEN của Production, rồi redeploy.",
    };
  if (/store does not exist/i.test(message))
    return {
      code: "BLOB_STORE_MISSING",
      status: 503,
      message:
        "Kho Blob đã cấu hình không tồn tại. Hãy kết nối lại đúng kho ảnh rồi redeploy.",
    };
  if (/suspended/i.test(message))
    return {
      code: "BLOB_SUSPENDED",
      status: 503,
      message:
        "Kho Blob đang bị tạm ngưng. Kiểm tra trạng thái và hạn mức trong Vercel Storage.",
    };
  if (
    /too many requests|service.*not available|fetch failed|timed out|aborted/i.test(
      message,
    )
  )
    return {
      code: "BLOB_UNAVAILABLE",
      status: 503,
      message:
        "Chưa kết nối được tới dịch vụ lưu ảnh. Vui lòng thử lại sau ít phút.",
    };
  return {
    code: "UPLOAD_FAILED",
    status: 500,
    message: "Không thể tải ảnh lên. Vui lòng tra mã lỗi trong Vercel Logs.",
  };
}
