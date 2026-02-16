-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

drop index if exists oneroster12.users_sourcedid;
drop index if exists oneroster12.users_participantusi;
drop materialized view if exists oneroster12.users;
--
create materialized view if not exists oneroster12.users as
with student as (
    select * from edfi.student
),
student_school as (
    select * from edfi.studentSchoolAssociation
),
school as (
    select * from edfi.school
),
staff as (
    select * from edfi.staff
),
staff_school as (
    select * from edfi.staffschoolassociation
),
staff_edorg_assign as (
    select * from edfi.staffeducationorganizationassignmentassociation
),
student_ids as (
    select
        seoa_sid.studentusi,
        seoa_sid.educationOrganizationId,
        json_agg(
            json_build_object(
                'type', studentIDsystemDescriptor.codeValue,
                'identifier', identificationcode
            )
            order by studentIDsystemDescriptor.codeValue
        ) as ids
    from edfi.studenteducationorganizationassociationstudentidentifica_c15030 seoa_sid
        join edfi.descriptor studentIDsystemDescriptor
            on seoa_sid.studentIdentificationSystemDescriptorId=studentIDsystemDescriptor.descriptorId
    group by 1,2
),
student_email as (
    select x.*
    from (
        select
            seoa_et.*,
            emailtypedescriptor.codevalue = 'Home/Personal' as is_preferred,
            row_number() over(
                partition by studentusi
                order by (emailtypedescriptor.codevalue = 'Home/Personal') desc nulls last,
                         emailtypedescriptor.codevalue
            ) as seq
        from edfi.studenteducationorganizationassociationelectronicmail as seoa_et
            join edfi.descriptor emailtypedescriptor
                on seoa_et.electronicMailTypeDescriptorId=emailtypedescriptor.descriptorid
    ) x
    where seq = 1 and (donotpublishindicator is null or not donotpublishindicator)
),
student_orgs as (
    select
        studentusi,
        school.localEducationAgencyId,
        school.schoolId,
        md5(school.schoolId::text) as sourcedid,
        student_school.primarySchool,
        student_school.entryDate
    from student_school
        join school
            on student_school.schoolId = school.schoolId
),
student_primary_org as (
    select studentusi, schoolid
    from (
        select
            studentusi,
            schoolid,
            row_number() over (
                partition by studentusi
                order by (case when primarySchool then 1 else 0 end) desc,
                         entryDate desc,
                         schoolid
            ) as seq
        from student_orgs
    ) ranked
    where seq = 1
),
student_edorg as (
    select
        studentusi,
        educationOrganizationId,
        max(lastModifiedDate) as edorg_lmdate
    from edfi.studentEducationOrganizationAssociation
    group by 1,2
),
student_orgs_agg as (
    select
        student_orgs.studentusi,
        json_agg(
            json_build_object(
                'roleType', case
                    when student_primary_org.schoolid is not null
                         and student_orgs.schoolid = student_primary_org.schoolid then 'primary'
                    else 'secondary'
                end,
                'role', 'student',
                'org', json_build_object(
                    'href', concat('/orgs/', student_orgs.sourcedid::text),
                    'sourcedId', student_orgs.sourcedid,
                    'type', 'org'
                )
            )
        ) AS "roles"
    from student_orgs
        left join student_primary_org
            on student_orgs.studentusi = student_primary_org.studentusi
    group by student_orgs.studentusi
),
student_grade as (
    select x.*
    from (
        select
            studentusi,
            schoolyear,
            gradeleveldescriptor.codevalue as grade_level,
            row_number() over(
                partition by studentusi, schoolyear
                order by
                    entrydate desc,
                    exitwithdrawdate desc nulls first,
                    gradeleveldescriptor.codevalue desc
            ) as seq
        from student_school
            join edfi.descriptor gradeleveldescriptor
                on student_school.entrygradeleveldescriptorid=gradeleveldescriptor.descriptorid
    ) x
    where seq = 1
),
formatted_users_student as (
    select
        md5(
            case
                when student_edorg.educationOrganizationId is null then concat('STU-', student.studentUniqueId::text)
                else concat('STU-', student.studentUniqueId::text, '-', student_edorg.educationOrganizationId::text)
            end
          ) as "sourcedId",
            'active' as "status",
            case
                when student_edorg.edorg_lmdate is not null
                     and (student.lastmodifieddate is null or student_edorg.edorg_lmdate > student.lastmodifieddate)
                    then student_edorg.edorg_lmdate
                else student.lastmodifieddate
            end as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when student_email.electronicmailaddress is null then '' else student_email.electronicmailaddress end as "username",
        case when student_ids.ids is not null then
            jsonb_insert(
                student_ids.ids::jsonb,
                '{0}',
                json_build_object(
                    'type', 'studentUniqueId',
                    'identifier', student.studentUniqueId
                )::jsonb
            )::json
        else
            json_build_array(json_build_object(
                'type', 'studentUniqueId',
                'identifier', student.studentUniqueId
            ))
        end as "userIds",
        'true' as "enabledUser",
        student.firstname as "givenName",
        student.lastsurname as "familyName",
        student.middlename as "middleName",
        student.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        student.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        'student' as "role",
        student_orgs_agg.roles AS "roles",
        null as "userProfiles",
        student.studentuniqueid as "identifier",
            student_edorg.educationOrganizationId as "educationOrganizationId",
        student.studentusi as "participantUSI",
        student_email.electronicmailaddress as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        json_build_array(student_grade.grade_level) as "grades",
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'students',
                'naturalKey', json_build_object(
                    'studentUniqueId', student.studentuniqueid
                ),
                'educationOrganizationId', student_edorg.educationOrganizationId
            )
        ) AS metadata
    from student
    left join student_grade
        on student.studentusi = student_grade.studentusi
    left join student_orgs_agg
        on student.studentusi = student_orgs_agg.studentusi
    left join student_edorg
        on student.studentusi = student_edorg.studentusi
    left join student_ids
        on student.studentusi = student_ids.studentusi
        and student_ids.educationOrganizationId = student_edorg.educationOrganizationId
    left join student_email
        on student.studentusi = student_email.studentusi
),
teaching_staff as (
    select distinct staffusi
    from edfi.staffsectionassociation
),
lea_staff_classification as (
    select
        staff_school.*,
        mappedstaffclassificationdescriptor.mappedvalue as lea_staff_classification
    from staff_school
        join school
            on staff_school.schoolid = school.schoolid
        left join edfi.localeducationagency
            on school.localeducationagencyid=localeducationagency.localeducationagencyid
        left join staff_edorg_assign
            on staff_school.staffusi = staff_edorg_assign.staffusi
            and localeducationagency.localeducationagencyid  = staff_edorg_assign.educationorganizationid
        left join edfi.descriptor staffclassificationdescriptor
            on staff_edorg_assign.staffclassificationdescriptorid=staffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedstaffclassificationdescriptor
            on mappedstaffclassificationdescriptor.value=staffclassificationdescriptor.codevalue
                and mappedstaffclassificationdescriptor.namespace=staffclassificationdescriptor.namespace
                and mappedstaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
    where localeducationagency.localeducationagencyid is not null
        and staffclassificationdescriptor.codeValue is not null
),
staff_school_with_classification as (
    select
        staff_school.*,
        coalesce(mappedschoolstaffclassificationdescriptor.mappedvalue,
                 mappedleastaffclassificationdescriptor.mappedvalue) as staff_classification
    from staff_school
        join school
            on staff_school.schoolid=school.schoolid
        left join staff_edorg_assign school_assign
            on staff_school.staffusi = school_assign.staffusi
            and staff_school.schoolid = school_assign.educationorganizationid
        left join staff_edorg_assign lea_assign
            on staff_school.staffusi = lea_assign.staffusi
            and school.localeducationagencyid = lea_assign.educationorganizationid
        left join edfi.descriptor schoolstaffclassificationdescriptor
            on school_assign.staffclassificationdescriptorid=schoolstaffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedschoolstaffclassificationdescriptor
            on mappedschoolstaffclassificationdescriptor.value=schoolstaffclassificationdescriptor.codevalue
                and mappedschoolstaffclassificationdescriptor.namespace=schoolstaffclassificationdescriptor.namespace
                and mappedschoolstaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
        left join edfi.descriptor leastaffclassificationdescriptor
            on lea_assign.staffclassificationdescriptorid=leastaffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedleastaffclassificationdescriptor
            on mappedleastaffclassificationdescriptor.value=leastaffclassificationdescriptor.codevalue
                and mappedleastaffclassificationdescriptor.namespace=leastaffclassificationdescriptor.namespace
                and mappedleastaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
    where school.schoolid is not null
),
staff_role as (
    select x.*
    from (
        select
            staff_school.staffusi,
            coalesce(staff_school.staff_classification, 'teacher') as staff_classification,
            row_number() over(partition by staff_school.staffusi order by staff_classification) as seq
        from staff_school_with_classification as staff_school
        left join teaching_staff
            on staff_school.staffusi = teaching_staff.staffusi
        where (staff_school.staff_classification is not null or teaching_staff.staffusi is not null)
    ) x
    where seq = 1
),
staff_ids as (
    select
        staffusi,
        json_agg(
            json_build_object(
                'type', staffIDsystemDescriptor.codeValue,
                'identifier', identificationcode
            )
            order by staffIDsystemDescriptor.codeValue
        ) as ids
    from edfi.staffidentificationcode
        join edfi.descriptor staffIDsystemDescriptor
            on staffidentificationcode.staffIdentificationSystemDescriptorId=staffIDsystemDescriptor.descriptorId
    group by 1
),
staff_orgs as (
    select
        staffusi,
        schoolid,
        staff_classification,
        createdate
    from staff_school_with_classification
),
staff_primary_org as (
    select staffusi, schoolid
    from (
        select
            staffusi,
            schoolid,
            row_number() over (
                partition by staffusi
                order by createdate desc, schoolid
            ) as seq
        from staff_orgs
    ) ranked
    where seq = 1
),
staff_orgs_agg as (
    select
        so.staffusi,
        json_agg(
            json_build_object(
                'roleType', case when spo.schoolid is not null and so.schoolid = spo.schoolid then 'primary' else 'secondary' end,
                'role', so.staff_classification,
                'org', json_build_object(
                    'href', concat('/orgs/', md5(so.schoolid::text)),
                    'sourcedId', md5(so.schoolid::text),
                    'type', 'org'
                )
            )
        ) AS "roles"
    from staff_orgs so
        left join staff_primary_org spo
            on so.staffusi = spo.staffusi
    group by so.staffusi
),
staff_email as (
    select
        staffusi,
        null::int as educationorganizationid,
        donotpublishindicator,
        electronicMailTypeDescriptor.codeValue as email_type,
        electronicmailaddress as email_address
    from edfi.staffelectronicmail
        join edfi.descriptor electronicMailTypeDescriptor
            on staffelectronicmail.electronicMailTypeDescriptorId=electronicMailTypeDescriptor.descriptorId
),
staff_edorg_email as (
    select
        seoca.staffusi,
        seoca.educationorganizationid,
        null::boolean as donotpublishindicator,
        seoca.contacttitle as email_type,
        seoca.electronicmailaddress as email_address
    from edfi.staffeducationorganizationcontactassociation as seoca
        join staff
            on seoca.staffusi = staff.staffusi
),
stacked_emails as (
    select * from staff_email
    union all
    select * from staff_edorg_email
),
staff_emails as (
    select
        *,
        email_address ~ '^[a-zA-Z0-9_.-]+[+]?[a-zA-Z0-9.-]*@[a-zA-Z0-9.-]+[.][a-zA-Z0-9]{2,9}$' as is_valid_email
    from stacked_emails
),
choose_email as (
    select x.*
    from (
        select
            *,
            email_type = 'Work' as is_preferred,
            row_number() over(
                partition by staffusi
                order by (email_type = 'Work') desc nulls last, email_type
            ) as seq
        from staff_emails
    ) x
    where seq = 1 and (donotpublishindicator is null or not donotpublishindicator)
),
formatted_users_staff as (
    select
        md5(
            case
                when staff_primary_org.schoolid is null then concat('STA-', staffUniqueId::text)
                else concat('STA-', staffUniqueId::text, '-', staff_primary_org.schoolid::text)
            end
        ) as "sourcedId",
        'active' as "status",
        lastmodifieddate as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when choose_email.email_address is null then '' else choose_email.email_address end as "username",
        jsonb_insert(
            staff_ids.ids::jsonb,
            '{0}',
            json_build_object(
                'type', 'staffUniqueId',
                'identifier', staff.staffUniqueId
            )::jsonb
        )::json as "userIds",
        'true' as "enabledUser",
        staff.firstname as "givenName",
        staff.lastsurname as "familyName",
        staff.middlename as "middleName",
        staff.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        staff.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        staff_role.staff_classification as "role",
        staff_orgs_agg.roles AS "roles",
        null::text as "userProfiles",
        staff.staffUniqueId as "identifier",
        staff_primary_org.schoolid as "educationOrganizationId",
        staff.staffusi as "participantUSI",
        choose_email.email_address as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        null::json as "grades",
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'staffs',
                'naturalKey', json_build_object(
                    'staffUniqueId', staffUniqueId
                ),
                'staffClassification', staff_role.staff_classification,
                'educationOrganizationId', staff_primary_org.schoolid
            )
        ) AS metadata
    from staff
        left join staff_ids
            on staff.staffusi = staff_ids.staffusi
        left join staff_role
            on staff.staffusi = staff_role.staffusi
        left join staff_orgs_agg
            on staff.staffusi = staff_orgs_agg.staffusi
        left join choose_email
            on staff.staffusi = choose_email.staffusi
        left join staff_primary_org
            on staff.staffusi = staff_primary_org.staffusi
),
contact_orgs as (
    select
        sca.contactusi,
        s.schoolId,
        row_number() over (
            partition by sca.contactusi
            order by ssa.entryDate desc, s.schoolId
        ) as seq
    from edfi.studentcontactassociation sca
    join edfi.studentSchoolAssociation ssa on sca.studentUSI = ssa.studentUSI
    join edfi.school s on ssa.SchoolId = s.SchoolId
),
contact_primary_org as (
    select contactusi, schoolId
    from contact_orgs
    where seq = 1
),
parent_roles as (
    select
        contactusi,
        json_agg(
            json_build_object(
                'roleType', 'primary',
                'role', 'parent',
                'org', json_build_object(
                    'href', concat('/orgs/', md5(schoolid::text)),
                    'sourcedId', md5(schoolid::text),
                    'type', 'org'
                )
            )
        ) as roles
    from contact_orgs
    group by contactusi
),
parent_emails as (
    select contactusi, electronicmailaddress
    from (
        select
            ce.contactusi,
            ce.electronicmailaddress,
            row_number() over (
                partition by ce.contactusi
                order by ce.electronicmailaddress
            ) as seq
        from edfi.contactelectronicmail ce
        where primaryemailaddressindicator and not donotpublishindicator
    ) ranked
    where seq = 1
),
formatted_users_parents as (
    select
        md5(
            case
                when cpo.schoolid is null then concat('PAR-', contactUniqueId::text)
                else concat('PAR-', contactUniqueId::text, '-', cpo.schoolid::text)
            end
        ) as "sourcedId",
        'active' as "status",
        contact.lastmodifieddate as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when parent_emails.electronicmailaddress is null then '' else parent_emails.electronicmailaddress end as "username",
        json_build_array(json_build_object(
            'type', 'contactUniqueId',
            'identifier', contact.contactUniqueId
        )) as "userIds",
        'true' as "enabledUser",
        contact.firstname as "givenName",
        contact.lastsurname as "familyName",
        contact.middlename as "middleName",
        contact.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        contact.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        'parent' as "role",
        parent_roles.roles AS "roles",
        null::text as "userProfiles",
        contact.contactUniqueId as "identifier",
        cpo.schoolId as "educationOrganizationId",
        contact.contactusi as "participantUSI",
        parent_emails.electronicmailaddress as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        null::json as "grades",
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'contacts',
                'naturalKey', json_build_object(
                    'contactUniqueId', contactUniqueId
                ),
                'educationOrganizationId', cpo.schoolId
            )
        ) AS metadata
    from edfi.contact
        left join parent_emails
            on contact.contactusi = parent_emails.contactusi
        left join parent_roles
            on contact.contactusi = parent_roles.contactusi
        left join contact_primary_org cpo
            on contact.contactusi = cpo.contactusi
)
select * from formatted_users_student
union all
select * from formatted_users_staff
union all
select * from formatted_users_parents;

create index if not exists users_sourcedid ON oneroster12.users ("sourcedId");
create index if not exists users_participantusi ON oneroster12.users ("participantUSI");
