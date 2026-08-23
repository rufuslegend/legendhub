import {formatCookie} from "../../lib/cookies.js";

export function columnsPreferenceCookie(columns, writtenAt = new Date()) {
    const expires = new Date(writtenAt);
    expires.setFullYear(expires.getFullYear() + 20);
    return formatCookie("sc2", columns.join("-"), {expires});
}
