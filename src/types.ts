export type ArtistId = "ocha" | "morning" | "karin";

export type EventType =
  | "concert"
  | "festival"
  | "fc"
  | "birthday"
  | "release"
  | "individual"
  | "stage"
  | "online"
  | "other";

export type TicketStatus =
  | "無料"
  | "受付前"
  | "受付中"
  | "当日券受付中"
  | "抽選結果待ち"
  | "一般発売予定"
  | "販売終了"
  | "完売"
  | "未発表";

export interface EventSession {
  label?: string;
  doors?: string;
  start?: string;
  /** 終演・終了時刻が公式に確認できる場合だけ指定します。 */
  end?: string;
}

export interface CalendarEvent {
  id: string;
  artist: ArtistId;
  /** 複数組が出演するイベントは、主催元の掲載順などに応じて補助的に指定します。 */
  artists?: ArtistId[];
  title: string;
  shortTitle: string;
  startDate: string;
  endDate?: string;
  venue?: string;
  prefecture?: string;
  eventType: EventType;
  fcOnly?: boolean;
  performers?: string[];
  sessions?: EventSession[];
  notes?: string;
  officialUrl?: string;
  ticketStatus?: TicketStatus;
  ticketSalesDate?: string;
  ticketSalesEndDate?: string;
}
