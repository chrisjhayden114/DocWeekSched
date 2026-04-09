export type Role = "ADMIN" | "ATTENDEE" | "SPEAKER";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type Event = {
  id: string;
  name: string;
  timezone: string;
  startDate: string;
  endDate: string;
};

export type Session = {
  id: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  speakerId?: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type Survey = {
  id: string;
  title: string;
  questions: SurveyQuestion[];
};

export type SurveyQuestion = {
  id: string;
  prompt: string;
  type: "SINGLE" | "MULTI" | "TEXT";
  options?: string[];
};

export type Message = {
  id: string;
  body: string;
  userId: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  name?: string | null;
  type: "EVENT" | "DIRECT" | "GROUP";
  createdAt: string;
};
