insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','prop@x'),('00000000-0000-0000-0000-000000000002','rh@x'),
 ('00000000-0000-0000-0000-000000000003','mgr@x'),('00000000-0000-0000-0000-000000000004','a@x'),
 ('00000000-0000-0000-0000-000000000005','b@x'),('00000000-0000-0000-0000-000000000006','mgr2@x');
insert into companies(id, raison_sociale, data) values ('C1','Test', '{"shifts":[{"id":"s1","employeeId":"E4","weekday":"Lun","heureDebut":"09:00","heureFin":"17:00"},{"id":"s2","employeeId":"E5","weekday":"Mar","heureDebut":"09:00","heureFin":"17:00"}],"shiftSwapRequests":[],"pointages":[]}');
insert into employees(id,company_id,auth_user_id,email,role,nom,prenom,manager_ids,data) values
 ('E1','C1','00000000-0000-0000-0000-000000000001','prop@x','proprietaire','P','P','{}','{"salaireBrutMensuel":9000}'),
 ('E2','C1','00000000-0000-0000-0000-000000000002','rh@x','rh','R','R','{}','{}'),
 ('E3','C1','00000000-0000-0000-0000-000000000003','mgr@x','manager','M','M','{}','{}'),
 ('E4','C1','00000000-0000-0000-0000-000000000004','a@x','salarie','A','A','{E3}','{"salaireBrutMensuel":2500}'),
 ('E5','C1','00000000-0000-0000-0000-000000000005','b@x','salarie','B','B','{E3}','{"salaireBrutMensuel":2600}'),
 ('E6','C1','00000000-0000-0000-0000-000000000006','mgr2@x','manager','M2','M2','{}','{}');
