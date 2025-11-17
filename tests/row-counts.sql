-- This SQL script contains SQL for row-count tests for the `edfi-oneroster` project.
-- Follow the comments below to confirm that the row-counts for OneRoster materialized
-- views match what is expected from the Ed-Fi tables they are based on.


-- (for OneRoster academicSessions) this Ed-Fi count:
select count(distinct md5(concat(
            schoolid::varchar,
            '-', sessionname::varchar
        ))) from edfi.session;
-- should equal this OneRoster count - 1 (for the school year):
select count(distinct "sourcedId") from oneroster12.academicsessions;



-- (for OneRoster classes) this Ed-Fi count:
select count(distinct md5(concat(
            lower(section.localcoursecode)::varchar,
            '-', section.schoolid::varchar,
            '-', lower(section.sectionidentifier)::varchar,
            '-', lower(section.sessionname)::varchar)
        )) from edfi.section;
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.classes;



-- (for OneRoster courses) this Ed-Fi count:
select count(distinct md5(concat(
            s.localEducationAgencyId::varchar,
            '-', crs.courseCode::varchar
        ))) as "sourcedId"
from edfi.course crs
	-- (Ok to do `join`, not `left join` here, because we only want courses
	-- actually _offered_ at a school.)
	join edfi.courseoffering co on crs.coursecode = co.coursecode
	join edfi.school s on co.schoolid = s.schoolid
order by "sourcedId";
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.courses;



-- (for OneRoster demographics) this Ed-Fi count:
select count(distinct md5(student.id::text)) from edfi.student;
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.demographics;



-- (for OneRoster enrollments) the sum of these two Ed-Fi counts:
select count(distinct md5(concat(
            lower(staff.staffUniqueId)::varchar,
            '-', lower(section.localcoursecode)::varchar,
            '-', section.schoolid::varchar,
            '-', lower(section.sectionidentifier)::varchar,
            '-', lower(section.sessionname)::varchar,
            '-', beginDate::varchar
        ))) from edfi.staffSectionAssociation ssa
        join edfi.staff on ssa.staffusi = staff.staffusi
        join edfi.section
            on ssa.sectionIdentifier = section.sectionIdentifier
                and ssa.localCourseCode = section.localCourseCode
                and ssa.schoolId = section.schoolId
                and ssa.schoolYear = section.schoolYear
                and ssa.sessionName = section.sessionName;
select count(distinct md5(concat(
            lower(student.studentUniqueId)::varchar,
            '-', lower(section.localcoursecode)::varchar,
            '-', section.schoolid::varchar,
            '-', lower(section.sectionidentifier)::varchar,
            '-', lower(section.sessionname)::varchar,
            '-', beginDate::varchar
        ))) from edfi.studentSectionAssociation ssa
        join edfi.student on ssa.studentusi = student.studentusi
        join edfi.section
            on ssa.sectionIdentifier = section.sectionIdentifier
                and ssa.localCourseCode = section.localCourseCode
                and ssa.schoolId = section.schoolId
                and ssa.schoolYear = section.schoolYear
                and ssa.sessionName = section.sessionName;
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.enrollments;



-- (for OneRoster orgs) the sum of these three Ed-Fi counts:
select count(distinct md5(stateEducationAgencyId::text)) from edfi.stateeducationagency;
select count(distinct md5(localEducationAgencyId::text)) from edfi.localeducationagency;
select count(distinct md5(schoolId::text)) from edfi.school;
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.orgs;



-- (for OneRoster users) the sum of these three Ed-Fi counts:
select count(distinct md5(concat('STU-', studentUniqueId::text))) from edfi.student;
select count(distinct md5(concat('STA-', staffUniqueId::text))) from edfi.staff;
select count(distinct md5(concat('PAR-', contactUniqueId::text))) from edfi.contact;
-- should equal this OneRoster count:
select count(distinct "sourcedId") from oneroster12.users;
