-- Vinz Gadget Empire — phone inventory schema + seed data
-- Run this whole file once in Supabase: Project → SQL Editor → New Query → paste → Run.

create table if not exists phones (
  id           bigint generated always as identity primary key,
  model        text not null,
  storage      text not null,
  category     text not null check (category in ('new_lineup', 'preowned_lineup')),
  tag          text,              -- e.g. 'New / Sealed', 'Featured' (new_lineup only)
  image        text not null,     -- relative path, e.g. './assets/phones/iphone-17.png'
  new_price    text,              -- e.g. 'RM 3,699'; null for preowned-only models
  used_price   text,              -- e.g. 'RM 3,199'; the single price for preowned_lineup rows
  sort_order   integer not null,
  in_stock     boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Allow the public website to READ the table (no login) but not write to it.
alter table phones enable row level security;

create policy "Public can read phones"
  on phones for select
  using (true);

-- Seed with your current price list, in original display order.
insert into phones (model, storage, category, tag, image, new_price, used_price, sort_order)
values
('iPhone 17', '256GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-17.png', 'RM 3,699', 'RM 3,199', 1),
('iPhone 17', '512GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-17.png', 'RM 4,599', 'RM 3,599', 2),
('iPhone Air', '256GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-air.png', 'RM 3,699', 'RM 3,099', 3),
('iPhone Air', '512GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-air.png', 'RM 4,699', 'RM 3,499', 4),
('iPhone Air', '1TB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-air.png', 'RM 5,699', 'RM 3,799', 5),
('iPhone 17 Pro', '256GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-17-pro.png', 'RM 5,199', 'RM 4,399', 6),
('iPhone 17 Pro', '512GB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-17-pro.png', 'RM 6,199', 'RM 4,899', 7),
('iPhone 17 Pro', '1TB', 'new_lineup', 'New / Sealed', './assets/phones/iphone-17-pro.png', 'RM 7,199', 'RM 5,399', 8),
('iPhone 17 Pro Max', '256GB', 'new_lineup', 'Featured', './assets/phones/iphone-17-pro-max.png', 'RM 5,500', 'RM 4,899', 9),
('iPhone 17 Pro Max', '512GB', 'new_lineup', 'Featured', './assets/phones/iphone-17-pro-max.png', 'RM 6,599', 'RM 5,699', 10),
('iPhone 17 Pro Max', '1TB', 'new_lineup', 'Featured', './assets/phones/iphone-17-pro-max.png', 'RM 7,599', 'RM 6,299', 11),
('iPhone 17 Pro Max', '2TB', 'new_lineup', 'Featured', './assets/phones/iphone-17-pro-max.png', 'RM 8,899', 'RM 7,299', 12),
('iPhone 13', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-13.png', NULL, 'RM 1,099', 13),
('iPhone 13', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-13.png', NULL, 'RM 1,249', 14),
('iPhone 13', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-13.png', NULL, 'RM 1,349', 15),
('iPhone 13 Pro', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro.png', NULL, 'RM 1,449', 16),
('iPhone 13 Pro', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro.png', NULL, 'RM 1,549', 17),
('iPhone 13 Pro', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro.png', NULL, 'RM 1,699', 18),
('iPhone 13 Pro', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro.png', NULL, 'RM 1,799', 19),
('iPhone 13 Pro Max', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro-max.png', NULL, 'RM 1,599', 20),
('iPhone 13 Pro Max', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro-max.png', NULL, 'RM 1,699', 21),
('iPhone 13 Pro Max', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro-max.png', NULL, 'RM 1,799', 22),
('iPhone 13 Pro Max', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-13-pro-max.png', NULL, 'RM 1,899', 23),
('iPhone 14', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-14.png', NULL, 'RM 1,399', 24),
('iPhone 14', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-14.png', NULL, 'RM 1,549', 25),
('iPhone 14', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-14.png', NULL, 'RM 1,699', 26),
('iPhone 14 Plus', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-plus.png', NULL, 'RM 1,549', 27),
('iPhone 14 Plus', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-plus.png', NULL, 'RM 1,749', 28),
('iPhone 14 Plus', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-plus.png', NULL, 'RM 1,899', 29),
('iPhone 14 Pro', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro.png', NULL, 'RM 1,899', 30),
('iPhone 14 Pro', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro.png', NULL, 'RM 2,099', 31),
('iPhone 14 Pro', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro.png', NULL, 'RM 2,249', 32),
('iPhone 14 Pro', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro.png', NULL, 'RM 2,399', 33),
('iPhone 14 Pro Max', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro-max.png', NULL, 'RM 2,099', 34),
('iPhone 14 Pro Max', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro-max.png', NULL, 'RM 2,299', 35),
('iPhone 14 Pro Max', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro-max.png', NULL, 'RM 2,449', 36),
('iPhone 14 Pro Max', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-14-pro-max.png', NULL, 'RM 2,599', 37),
('iPhone 15', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-15.png', NULL, 'RM 1,899', 38),
('iPhone 15', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-15.png', NULL, 'RM 2,099', 39),
('iPhone 15', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-15.png', NULL, 'RM 2,249', 40),
('iPhone 15 Plus', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-plus.png', NULL, 'RM 2,199', 41),
('iPhone 15 Plus', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-plus.png', NULL, 'RM 2,399', 42),
('iPhone 15 Plus', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-plus.png', NULL, 'RM 2,549', 43),
('iPhone 15 Pro', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro.png', NULL, 'RM 2,299', 44),
('iPhone 15 Pro', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro.png', NULL, 'RM 2,499', 45),
('iPhone 15 Pro', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro.png', NULL, 'RM 2,699', 46),
('iPhone 15 Pro', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro.png', NULL, 'RM 2,899', 47),
('iPhone 15 Pro Max', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro-max.png', NULL, 'RM 2,899', 48),
('iPhone 15 Pro Max', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro-max.png', NULL, 'RM 3,099', 49),
('iPhone 15 Pro Max', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-15-pro-max.png', NULL, 'RM 3,299', 50),
('iPhone 16e', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-16e.png', NULL, 'RM 1,699', 51),
('iPhone 16e', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-16e.png', NULL, 'RM 1,899', 52),
('iPhone 16e', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-16e.png', NULL, 'RM 2,049', 53),
('iPhone 16', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-16.png', NULL, 'RM 2,399', 54),
('iPhone 16', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-16.png', NULL, 'RM 2,699', 55),
('iPhone 16', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-16.png', NULL, 'RM 2,899', 56),
('iPhone 16 Plus', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-plus.png', NULL, 'RM 2,699', 57),
('iPhone 16 Plus', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-plus.png', NULL, 'RM 2,999', 58),
('iPhone 16 Plus', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-plus.png', NULL, 'RM 3,199', 59),
('iPhone 16 Pro', '128GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro.png', NULL, 'RM 2,999', 60),
('iPhone 16 Pro', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro.png', NULL, 'RM 3,199', 61),
('iPhone 16 Pro', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro.png', NULL, 'RM 3,499', 62),
('iPhone 16 Pro', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro.png', NULL, 'RM 3,799', 63),
('iPhone 16 Pro Max', '256GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro-max.png', NULL, 'RM 3,599', 64),
('iPhone 16 Pro Max', '512GB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro-max.png', NULL, 'RM 3,899', 65),
('iPhone 16 Pro Max', '1TB', 'preowned_lineup', NULL, './assets/phones/iphone-16-pro-max.png', NULL, 'RM 4,199', 66)
;
